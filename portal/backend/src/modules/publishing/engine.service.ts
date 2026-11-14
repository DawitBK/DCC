import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { supportsInbox, type EngineChannel, type OperationalEngine } from '@dcc/engine-client';
import type {
  EngineChannelDto,
  EngineStatusDto,
  LinkEngineChannelRequest,
  SocialAccountDto,
} from '@dcc/contracts';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import { can, type Access } from '../../platform/authz/authz';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { ctxOf } from '../shared/tenant-scope';
import { OPERATIONAL_ENGINE } from './operational-engine.provider';

const uniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505';

/**
 * The bridge between the registry and the operational engine (W-03/W-09 side of the registry, H-02):
 * what the engine is, which channels it holds, and which registered account each channel belongs to.
 * An account can be published to only after it is linked to an engine channel here.
 *
 * DCC stores the engine's channel id and nothing else: no token, no password. The connection to the
 * social network itself is made inside the engine, through the network's official authorisation.
 */
@Injectable()
export class EngineService {
  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
    @Inject(OPERATIONAL_ENGINE) private readonly engine: OperationalEngine,
  ) {}

  status(): EngineStatusDto {
    const c = this.engine.capabilities();
    return {
      provider: c.provider,
      verification: c.verification,
      canPublish: c.publish,
      inbox: c.inbox === true && supportsInbox(this.engine),
      notes: c.notes,
    };
  }

  /** The engine's channels, each with the registered account it is linked to (if the caller can see it). */
  async channels(access: Access): Promise<EngineChannelDto[]> {
    const channels = await this.listFromEngine();
    if (channels.length === 0) return [];
    const linked = await this.tenant.run(ctxOf(access), (trx) =>
      trx
        .selectFrom('social_accounts')
        .select(['id', 'engine_channel_id'])
        .where(
          'engine_channel_id',
          'in',
          channels.map((c) => c.engineChannelId),
        )
        .execute(),
    );
    const byChannel = new Map(linked.map((a) => [a.engine_channel_id, a.id]));
    return channels.map((c) => ({
      engineChannelId: c.engineChannelId,
      name: c.name,
      platform: c.platform,
      disabled: c.disabled,
      linkedAccountId: byChannel.get(c.engineChannelId) ?? null,
    }));
  }

  /** Links a registered account to one engine channel, or unlinks it (`engineChannelId: null`). */
  async link(
    access: Access,
    accountId: string,
    input: LinkEngineChannelRequest,
  ): Promise<Pick<SocialAccountDto, 'id' | 'engineChannelId'>> {
    // Ask the engine before opening the transaction: a slow engine must not hold a database lock.
    let channel: EngineChannel | undefined;
    if (input.engineChannelId !== null) {
      channel = (await this.listFromEngine()).find(
        (c) => c.engineChannelId === input.engineChannelId,
      );
      if (!channel)
        throw new BadRequestException('The operational engine has no channel with that id.');
      if (channel.disabled)
        throw new BadRequestException('That channel is disabled in the operational engine.');
    }
    try {
      return await this.tenant.run(ctxOf(access), async (trx) => {
        const account = await trx
          .selectFrom('social_accounts')
          .select(['id', 'company_id', 'platform', 'engine_channel_id'])
          .where('id', '=', accountId)
          .executeTakeFirst();
        if (!account) throw new NotFoundException('Social account not found.');
        const company = await trx
          .selectFrom('companies')
          .select('group_id')
          .where('id', '=', account.company_id)
          .executeTakeFirstOrThrow();
        if (
          !can(access, 'account.manage', {
            groupId: company.group_id,
            companyId: account.company_id,
          })
        )
          throw new ForbiddenException('You cannot manage this account.');
        if (channel && channel.platform !== account.platform)
          throw new BadRequestException(
            `That channel is a ${channel.platform ?? 'network DCC does not govern'} channel; this account is registered as ${account.platform}.`,
          );

        await trx
          .updateTable('social_accounts')
          .set({ engine_channel_id: input.engineChannelId, updated_at: new Date() })
          .where('id', '=', accountId)
          .execute();

        await this.audit.record(trx, {
          action: input.engineChannelId
            ? AuditActions.accountEngineLinked
            : AuditActions.accountEngineUnlinked,
          actorUserId: access.userId,
          targetType: 'social_account',
          targetId: accountId,
          companyId: account.company_id,
          details: { from: account.engine_channel_id, to: input.engineChannelId },
        });
        return { id: accountId, engineChannelId: input.engineChannelId };
      });
    } catch (error) {
      if (uniqueViolation(error))
        throw new ConflictException('That channel is already linked to another account.');
      throw error;
    }
  }

  private async listFromEngine(): Promise<EngineChannel[]> {
    try {
      return await this.engine.listChannels();
    } catch (error) {
      throw new BadGatewayException(
        `The operational engine did not answer: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}
