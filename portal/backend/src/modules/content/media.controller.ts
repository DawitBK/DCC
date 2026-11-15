import { mkdirSync } from 'node:fs';
import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { MAX_VIDEO_BYTES, type ContentMediaDto } from '@dcc/contracts';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { MediaService } from './media.service';

const UploadQuery = z.object({ companyId: z.uuid() });

/** Pictures and videos for posts: upload one, and read one back. */
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post()
  @HttpCode(201)
  @RequirePermission('content.create')
  async upload(
    @CurrentAccess() access: Access,
    @Query(new ZodValidationPipe(UploadQuery)) q: z.infer<typeof UploadQuery>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ContentMediaDto> {
    // The file goes to disk, never to memory: a video can be 200 MB.
    mkdirSync(this.media.incomingDir(), { recursive: true });
    const receive = multer({
      dest: this.media.incomingDir(),
      limits: { fileSize: MAX_VIDEO_BYTES, files: 1 },
    }).single('file');
    await new Promise<void>((done, fail) =>
      receive(req, res, (error: unknown) => {
        if (!error) return done();
        const code = (error as { code?: string }).code;
        fail(
          new BadRequestException(
            code === 'LIMIT_FILE_SIZE'
              ? 'This file is too large. The limit is 200 MB.'
              : 'The upload could not be read. Send one file in the field "file".',
          ),
        );
      }),
    );
    const file = (req as Request & { file?: { path: string; originalname: string; size: number } })
      .file;
    if (!file) throw new BadRequestException('Send one file in the field "file".');
    return this.media.upload(access, q.companyId, file);
  }

  @Get(':id/file')
  @RequirePermission('content.read')
  async file(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { path, mimeType } = await this.media.fileOf(access, id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    // sendFile answers Range requests, which a video player needs to seek.
    res.sendFile(path, { dotfiles: 'deny' }, (error) => {
      if (error && !res.headersSent) res.status(404).end();
    });
  }
}
