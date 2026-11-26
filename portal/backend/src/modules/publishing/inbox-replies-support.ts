import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import {
  supportsInbox,
  type InboxEngine,
  type InboxMessage,
  type OperationalEngine,
} from '@dcc/engine-client';
import type { Permission } from '@dcc/contracts';
import type { Transaction } from 'kysely';
import { can, type Access } from '../../platform/authz/authz';
import type { DB } from '../../platform/database/schema';

export const DAY_MS = 24 * 60 * 60 * 1000;
/** How far back an approver or the acknowledgement looks for the message being answered. */
export const MESSAGE_LOOKBACK_DAYS = 90;

/** The engine's inbox, or a plain refusal when this engine has none (same words as the reply route). */
export function inboxOf(engine: OperationalEngine): InboxEngine {
  if (engine.capabilities().inbox !== true || !supportsInbox(engine))
    throw new NotImplementedException('The operational engine has no inbox yet.');
  return engine;
}

/** The message must belong to THIS account's channel: otherwise a person could act on another company's message by guessing its id. */
export async function findMessage(
  inbox: InboxEngine,
  channelId: string,
  engineMessageId: string,
  lookbackDays = MESSAGE_LOOKBACK_DAYS,
): Promise<InboxMessage | undefined> {
  const now = new Date();
  try {
    const found = await inbox.listInbox(
      { from: new Date(now.getTime() - lookbackDays * DAY_MS), to: now },
      channelId,
    );
    return found.find((m) => m.engineMessageId === engineMessageId);
  } catch {
    throw new BadGatewayException('The operational engine could not be reached.');
  }
}

export interface AccountForInbox {
  id: string;
  company_id: string;
  engine_channel_id: string;
  display_name: string;
  group_id: string;
}

/**
 * Loads a social account with its company, under the walls (an account of another company is a 404), re-checks that the
 * caller holds `permission` for THAT company, and refuses an inactive company, an archived account or an unlinked one.
 */
export async function loadAccountFor(
  trx: Transaction<DB>,
  access: Access,
  socialAccountId: string,
  permission: Permission,
  forbiddenMessage: string,
): Promise<AccountForInbox> {
  const row = await trx
    .selectFrom('social_accounts as a')
    .innerJoin('companies as c', 'c.id', 'a.company_id')
    .select([
      'a.id',
      'a.company_id',
      'a.engine_channel_id',
      'a.status',
      'a.display_name',
      'c.group_id',
      'c.status as company_status',
    ])
    .where('a.id', '=', socialAccountId)
    .executeTakeFirst();
  if (!row) throw new NotFoundException('Social account not found.');
  if (!can(access, permission, { groupId: row.group_id, companyId: row.company_id }))
    throw new ForbiddenException(forbiddenMessage);
  if (row.company_status !== 'active')
    throw new ConflictException(`The company is ${row.company_status}.`);
  if (row.status === 'archived') throw new ConflictException('This account is archived.');
  if (!row.engine_channel_id)
    throw new BadRequestException('This account is not connected to the operational engine yet.');
  return {
    id: row.id,
    company_id: row.company_id,
    engine_channel_id: row.engine_channel_id,
    display_name: row.display_name,
    group_id: row.group_id,
  };
}

/** Ethiopic letters (U+1200 to U+137F): a message that has some is answered in Amharic when the company wrote an Amharic text. */
export const hasEthiopic = (text: string): boolean => /[ሀ-፿]/.test(text);
