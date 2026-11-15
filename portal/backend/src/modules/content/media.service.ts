import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MEDIA_TYPES,
  type ContentMediaDto,
  type MediaKind,
} from '@dcc/contracts';
import type { Transaction } from 'kysely';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import { can, type Access } from '../../platform/authz/authz';
import type { DB } from '../../platform/database/schema';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { ctxOf } from '../shared/tenant-scope';

const EXTENSION: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
};

/** What the file really is, from its first bytes. The name and the browser's claim are not trusted. */
export function sniffMediaType(head: Buffer): string | null {
  const ascii = (from: number, to: number) => head.subarray(from, to).toString('latin1');
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3)
    return 'video/webm';
  if (ascii(4, 8) === 'ftyp')
    return ascii(8, 12).startsWith('qt') ? 'video/quicktime' : 'video/mp4';
  return null;
}

export const MEDIA_COLUMNS = [
  'id',
  'company_id',
  'uploaded_by',
  'kind',
  'file_name',
  'mime_type',
  'size_bytes',
  'created_at',
] as const;

export const toMediaDto = (r: {
  id: string;
  company_id: string;
  uploaded_by: string;
  kind: string;
  file_name: string;
  mime_type: string;
  size_bytes: string | number;
  created_at: Date;
}): ContentMediaDto => ({
  id: r.id,
  companyId: r.company_id,
  kind: r.kind as MediaKind,
  fileName: r.file_name,
  mimeType: r.mime_type,
  sizeBytes: Number(r.size_bytes),
  url: `/api/media/${r.id}/file`,
  uploadedBy: r.uploaded_by,
  createdAt: r.created_at.toISOString(),
});

/**
 * Pictures and videos for posts. Files live on the server's disk under DCC_MEDIA_DIR, one folder per
 * company; the database holds the record and row-level security decides who can see it. A file is
 * served only through the API, to a signed-in person who may read that company's content.
 */
@Injectable()
export class MediaService {
  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  private root(): string {
    return resolve(this.cfg.DCC_MEDIA_DIR ?? join(process.cwd(), 'var', 'media'));
  }

  /** Where uploads land before they are checked. */
  incomingDir(): string {
    return join(this.root(), '_incoming');
  }

  /**
   * A path under the media folder, and never outside it: whatever the parts are, the result is
   * refused unless it stays inside the folder.
   */
  private inside(...parts: string[]): string {
    const root = this.root();
    const absolute = resolve(root, ...parts);
    if (!absolute.startsWith(root + sep))
      throw new BadRequestException('That file is outside the media folder.');
    return absolute;
  }

  absolutePath(storageKey: string): string {
    return this.inside(storageKey);
  }

  async upload(
    access: Access,
    companyId: string,
    file: { path: string; originalname: string; size: number },
  ): Promise<ContentMediaDto> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId))
      throw new BadRequestException('companyId must be an id.');
    // Only the file's own name is used, and only inside the incoming folder.
    const incoming = this.inside('_incoming', basename(file.path));
    try {
      const handle = await open(incoming, 'r');
      const head = Buffer.alloc(16);
      await handle.read(head, 0, 16, 0);
      await handle.close();
      const mimeType = sniffMediaType(head);
      const kind = mimeType ? MEDIA_TYPES[mimeType] : undefined;
      if (!mimeType || !kind)
        throw new BadRequestException(
          'This file type is not accepted. Use JPEG, PNG, WebP or GIF pictures, or MP4, MOV or WebM videos.',
        );
      const size = (await stat(incoming)).size;
      const limit = kind === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
      if (size > limit)
        throw new PayloadTooLargeException(
          `This ${kind} is too large. The limit is ${Math.round(limit / (1024 * 1024))} MB.`,
        );

      const storageKey = `${companyId}/${randomUUID()}${EXTENSION[mimeType]}`;
      const dto = await this.tenant.run(ctxOf(access), async (trx) => {
        const company = await trx
          .selectFrom('companies')
          .select(['id', 'group_id', 'status'])
          .where('id', '=', companyId)
          .executeTakeFirst();
        if (!company) throw new NotFoundException('Company not found.');
        if (!can(access, 'content.create', { groupId: company.group_id, companyId }))
          throw new ForbiddenException('You cannot add media for this company.');
        const row = await trx
          .insertInto('content_media')
          .values({
            company_id: companyId,
            uploaded_by: access.userId,
            kind,
            file_name: file.originalname.slice(0, 200),
            mime_type: mimeType,
            size_bytes: size,
            storage_key: storageKey,
          })
          .returning(MEDIA_COLUMNS)
          .executeTakeFirstOrThrow();
        await this.audit.record(trx, {
          action: AuditActions.mediaUploaded,
          actorUserId: access.userId,
          targetType: 'content_media',
          targetId: row.id,
          companyId,
          details: { kind, mimeType, sizeBytes: size, fileName: row.file_name },
        });
        // Inside the transaction: if the move fails, the record is rolled back with it.
        await mkdir(this.inside(companyId), { recursive: true });
        await rename(incoming, this.inside(storageKey));
        return toMediaDto(row);
      });
      return dto;
    } finally {
      await rm(incoming, { force: true });
    }
  }

  /** The file behind a record, for a person who may read that company's content. */
  async fileOf(access: Access, id: string): Promise<{ path: string; mimeType: string }> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const row = await trx
        .selectFrom('content_media as m')
        .innerJoin('companies as c', 'c.id', 'm.company_id')
        .select(['m.storage_key', 'm.mime_type', 'm.company_id', 'c.group_id'])
        .where('m.id', '=', id)
        .executeTakeFirst();
      if (!row) throw new NotFoundException('Media not found.');
      if (!can(access, 'content.read', { groupId: row.group_id, companyId: row.company_id }))
        throw new ForbiddenException('You cannot see this media.');
      return { path: this.absolutePath(row.storage_key), mimeType: row.mime_type };
    });
  }

  /** The media of one version, in order. Used by the content service and by publishing. */
  async ofVersion(trx: Transaction<DB>, versionId: string) {
    return trx
      .selectFrom('content_version_media as vm')
      .innerJoin('content_media as m', 'm.id', 'vm.media_id')
      .select([
        'm.id',
        'm.company_id',
        'm.uploaded_by',
        'm.kind',
        'm.file_name',
        'm.mime_type',
        'm.size_bytes',
        'm.created_at',
        'm.storage_key',
      ])
      .where('vm.content_version_id', '=', versionId)
      .orderBy('vm.position')
      .execute();
  }

  /** Attach already uploaded media to a new version. Every id must be a media record of the same company. */
  async attach(
    trx: Transaction<DB>,
    companyId: string,
    versionId: string,
    mediaIds: readonly string[],
  ): Promise<void> {
    const unique = [...new Set(mediaIds)];
    if (unique.length === 0) return;
    const found = await trx
      .selectFrom('content_media')
      .select('id')
      .where('id', 'in', unique)
      .where('company_id', '=', companyId)
      .execute();
    if (found.length !== unique.length)
      throw new BadRequestException(
        'One of the pictures or videos does not exist for this company.',
      );
    await trx
      .insertInto('content_version_media')
      .values(
        unique.map((mediaId, position) => ({
          content_version_id: versionId,
          media_id: mediaId,
          company_id: companyId,
          position,
        })),
      )
      .execute();
  }
}
