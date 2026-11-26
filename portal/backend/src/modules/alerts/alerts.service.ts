import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  ALERT_BACKOFF_MINUTES,
  ALERT_CHANNELS,
  ALERT_MAX_ATTEMPTS,
  ROLE_PERMISSIONS,
  isSevereIncident,
  maskMobile,
  type AlertChannel,
  type AlertContactDto,
  type AlertContactResultDto,
  type AlertContactsDto,
  type AlertDeliveriesQuery,
  type AlertDeliveryDto,
  type AlertSettingsDto,
  type AlertStatusDto,
  type AlertTestResultDto,
  type IncidentSeverity,
  type Role,
  type SetAlertContactRequest,
  type SetAlertSettingsRequest,
  type TestAlertRequest,
} from '@dcc/contracts';
import { sql, type Transaction } from 'kysely';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import { can, type Access } from '../../platform/authz/authz';
import type { DB } from '../../platform/database/schema';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { NotificationsService } from '../notifications/notifications.service';
import { SweepService } from '../working-hours/sweep.service';
import { companyIdsWithPermission, ctxOf, NIL, systemCheckContext } from '../shared/tenant-scope';
import { readAlertConfig } from './alert-config';
import { composeAlert, composeTest, type AlertFacts } from './alert-messages';
import { AlertSendError, deliver, type TransportOptions } from './alert-transport';

type Trx = Transaction<DB>;

/**
 * D2-19, D2-20: who is told about a SEV1 (critical) and a SEV2 (high) incident. SEV1: the incident owner and security
 * (security_admin, group_cto), group_marketing and company_executive. SEV2: security_admin, company_marketing_manager,
 * company_executive. "The incident owner" is the person who opened the incident (an incident has no other owner field).
 */
export const ALERT_ROLES: Record<'critical' | 'high', readonly Role[]> = {
  critical: ['security_admin', 'group_cto', 'group_marketing', 'company_executive'],
  high: ['security_admin', 'company_marketing_manager', 'company_executive'],
};

const rankOf = (severity: IncidentSeverity): number => (severity === 'critical' ? 3 : 2);

const DEFAULT_SETTINGS = {
  smsEnabled: true,
  teamsEnabled: true,
  emailEnabled: true,
  minSeverity: 'high' as const,
};

/** The least time between two test alerts of one person on one channel (a test costs a real SMS or mail). */
const TEST_GAP_MS = 30_000;

const CHANNEL_WORDS: Record<AlertChannel, string> = { sms: 'SMS', teams: 'Teams', email: 'e-mail' };

/** The incident as the enqueue step needs it. */
export interface AlertIncident {
  id: string;
  company_id: string;
  title: string;
  severity: string;
  opened_by: string;
}

interface Claimed {
  id: string;
  company_id: string;
  group_id: string;
  incident_id: string;
  channel: AlertChannel;
  recipient_user_id: string | null;
  severity: 'critical' | 'high';
  subject: string;
  body: string;
  attempts: number;
  /** The number or address, read at send time: null when the person no longer has one. */
  target: string | null;
  /** The five attempts are used up and the last one never reported back (the server stopped during it). */
  exhausted?: boolean;
}

/** A link to the incident: the full address when DCC knows its public address, otherwise the path. */
const linkTo = (path: string): string => {
  const origin = (process.env.DCC_WEB_ORIGIN ?? '').trim().replace(/\/+$/, '');
  const base = (process.env.DCC_WEB_BASE_PATH ?? '').trim();
  return `${origin}${base}${path}`;
};

/**
 * RQ-029: alerts for SEV1 and SEV2 incidents by SMS, Teams and e-mail. An incident that is opened at (or raised to)
 * one of those severities writes `alert_deliveries` rows in the SAME transaction (the outbox); the sweep job `alerts`
 * sends them: five attempts with back-off of 1, 2, 4 and 8 minutes, never twice, the final failure audited and told
 * to the alert managers. Channel addresses and secrets are environment variables only (alert-config.ts).
 */
@Injectable()
export class AlertsService implements OnModuleInit {
  private readonly log = new Logger('Alerts');
  private readonly lastTest = new Map<string, number>();
  /** Timeouts and TLS options of the transports. Tests shorten them; production leaves the defaults. */
  transportOptions: TransportOptions = {};

  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly sweep: SweepService,
  ) {}

  onModuleInit(): void {
    this.sweep.register('alerts', (companyId, now) => this.sweepCompany(companyId, now));
  }

  // ---------------------------------------------------------------------------------------------------
  // Status, settings

  status(access: Access): AlertStatusDto {
    if (access.memberships.length === 0) throw new ForbiddenException('You have no access here.');
    return readAlertConfig().status;
  }

  async getSettings(access: Access, groupId?: string): Promise<AlertSettingsDto> {
    const group = this.groupFor(access, groupId);
    this.mustManage(access, group);
    return this.tenant.run(ctxOf(access), (trx) => this.settingsOf(trx, group));
  }

  async setSettings(
    access: Access,
    groupId: string | undefined,
    input: SetAlertSettingsRequest,
  ): Promise<AlertSettingsDto> {
    const group = this.groupFor(access, groupId);
    this.mustManage(access, group);
    return this.tenant.run(ctxOf(access), async (trx) => {
      const before = await this.settingsOf(trx, group);
      const row = await trx
        .insertInto('alert_settings')
        .values({
          group_id: group,
          sms_enabled: input.smsEnabled,
          teams_enabled: input.teamsEnabled,
          email_enabled: input.emailEnabled,
          min_severity: input.minSeverity,
          updated_by: access.userId,
          updated_at: new Date(),
        })
        .onConflict((oc) =>
          oc.column('group_id').doUpdateSet({
            sms_enabled: input.smsEnabled,
            teams_enabled: input.teamsEnabled,
            email_enabled: input.emailEnabled,
            min_severity: input.minSeverity,
            updated_by: access.userId,
            updated_at: new Date(),
          }),
        )
        .returning([
          'group_id',
          'sms_enabled',
          'teams_enabled',
          'email_enabled',
          'min_severity',
          'updated_at',
        ])
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, {
        action: AuditActions.alertSettingsSet,
        actorUserId: access.userId,
        targetType: 'alert_settings',
        targetId: group,
        groupId: group,
        details: {
          from: {
            sms: before.smsEnabled,
            teams: before.teamsEnabled,
            email: before.emailEnabled,
            minSeverity: before.minSeverity,
          },
          to: {
            sms: row.sms_enabled,
            teams: row.teams_enabled,
            email: row.email_enabled,
            minSeverity: row.min_severity,
          },
        },
      });
      return toSettingsDto(row);
    });
  }

  private async settingsOf(trx: Trx, groupId: string): Promise<AlertSettingsDto> {
    const row = await trx
      .selectFrom('alert_settings')
      .select([
        'group_id',
        'sms_enabled',
        'teams_enabled',
        'email_enabled',
        'min_severity',
        'updated_at',
      ])
      .where('group_id', '=', groupId)
      .executeTakeFirst();
    return row ? toSettingsDto(row) : { groupId, ...DEFAULT_SETTINGS, updatedAt: null };
  }

  // ---------------------------------------------------------------------------------------------------
  // Contacts

  async listContacts(access: Access, groupId?: string): Promise<AlertContactsDto> {
    const group = this.groupFor(access, groupId);
    const canManage = can(access, 'alert.manage', { groupId: group });
    // Others' numbers (masked) are shown to people who work with incidents; everyone sees their own.
    const seesOthers =
      canManage ||
      access.memberships.some(
        (m) => m.groupId === group && ROLE_PERMISSIONS[m.role].includes('incident.read'),
      );
    return this.tenant.run(ctxOf(access), async (trx) => {
      const rows = await trx
        .selectFrom('alert_contacts as c')
        .leftJoin('users as u', 'u.id', 'c.user_id')
        .select(['c.group_id', 'c.user_id', 'c.mobile', 'c.updated_at', 'u.display_name'])
        .where('c.group_id', '=', group)
        .$if(!seesOthers, (q) => q.where('c.user_id', '=', access.userId))
        .orderBy('u.display_name')
        .execute();
      const contacts: AlertContactDto[] = rows.map((r) => {
        const own = r.user_id === access.userId;
        const full = own || canManage;
        return {
          groupId: r.group_id,
          userId: r.user_id,
          displayName: r.display_name,
          mobile: full ? r.mobile : maskMobile(r.mobile),
          masked: !full,
          own,
          updatedAt: r.updated_at.toISOString(),
        };
      });
      return { groupId: group, contacts, canManage };
    });
  }

  async setContact(access: Access, input: SetAlertContactRequest): Promise<AlertContactResultDto> {
    const group = this.groupFor(access, input.groupId);
    const target = input.userId ?? access.userId;
    const own = target === access.userId;
    if (!own && !can(access, 'alert.manage', { groupId: group }))
      throw new ForbiddenException('You can only set your own mobile number.');
    return this.tenant.run(ctxOf(access), async (trx) => {
      if (!own) {
        const member = await trx
          .selectFrom('memberships')
          .select('id')
          .where('user_id', '=', target)
          .where('group_id', '=', group)
          .executeTakeFirst();
        if (!member) throw new NotFoundException('That person is not part of this group.');
      }
      const mobile = typeof input.mobile === 'string' ? input.mobile : null;
      let result: AlertContactDto | null = null;
      if (mobile === null) {
        await trx
          .deleteFrom('alert_contacts')
          .where('group_id', '=', group)
          .where('user_id', '=', target)
          .execute();
      } else {
        const row = await trx
          .insertInto('alert_contacts')
          .values({
            group_id: group,
            user_id: target,
            mobile,
            updated_by: access.userId,
            updated_at: new Date(),
          })
          .onConflict((oc) =>
            oc.columns(['group_id', 'user_id']).doUpdateSet({
              mobile,
              updated_by: access.userId,
              updated_at: new Date(),
            }),
          )
          .returning(['group_id', 'user_id', 'mobile', 'updated_at'])
          .executeTakeFirstOrThrow();
        result = {
          groupId: row.group_id,
          userId: row.user_id,
          displayName: null,
          mobile: row.mobile,
          masked: false,
          own,
          updatedAt: row.updated_at.toISOString(),
        };
      }
      // Never the number itself: who, whose, and whether it was set or removed.
      await this.audit.record(trx, {
        action: AuditActions.alertContactSet,
        actorUserId: access.userId,
        targetType: 'alert_contact',
        targetId: target,
        groupId: group,
        details: { userId: target, own, cleared: mobile === null },
      });
      return { contact: result };
    });
  }

  // ---------------------------------------------------------------------------------------------------
  // Deliveries (alert.manage)

  async listDeliveries(access: Access, query: AlertDeliveriesQuery): Promise<AlertDeliveryDto[]> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const companyIds = await companyIdsWithPermission(trx, access, 'alert.manage');
      const rows = await trx
        .selectFrom('alert_deliveries as d')
        .leftJoin('incidents as i', 'i.id', 'd.incident_id')
        .leftJoin('users as u', 'u.id', 'd.recipient_user_id')
        .select([
          'd.id',
          'd.company_id',
          'd.incident_id',
          'd.channel',
          'd.recipient_user_id',
          'd.severity',
          'd.subject',
          'd.status',
          'd.attempts',
          'd.last_error',
          'd.next_attempt_at',
          'd.created_at',
          'd.sent_at',
          'i.title as incident_title',
          'u.display_name as recipient_name',
        ])
        .where('d.company_id', 'in', companyIds.length ? companyIds : [NIL])
        .$if(query.status !== undefined, (q) => q.where('d.status', '=', query.status!))
        .$if(query.incidentId !== undefined, (q) =>
          q.where('d.incident_id', '=', query.incidentId!),
        )
        .orderBy('d.created_at', 'desc')
        .orderBy('d.id')
        .limit(query.limit ?? 100)
        .execute();
      return rows.map((r) => ({
        id: r.id,
        companyId: r.company_id,
        incidentId: r.incident_id,
        incidentTitle: r.incident_title,
        channel: r.channel,
        recipientUserId: r.recipient_user_id,
        recipientName: r.recipient_name,
        severity: r.severity,
        subject: r.subject,
        status: r.status,
        attempts: r.attempts,
        lastError: r.last_error,
        nextAttemptAt: r.status === 'pending' ? r.next_attempt_at.toISOString() : null,
        createdAt: r.created_at.toISOString(),
        sentAt: r.sent_at ? r.sent_at.toISOString() : null,
      }));
    });
  }

  // ---------------------------------------------------------------------------------------------------
  // Test alert

  /** Sends a test alert to the caller's own contact (or, for Teams, to the channel) and says what happened. */
  async test(
    access: Access,
    input: TestAlertRequest,
    now: Date = new Date(),
  ): Promise<AlertTestResultDto> {
    const group = this.groupFor(access, input.groupId);
    const channel = input.channel;
    // Teams has no personal contact: the message goes to the shared channel, so only an alert manager may send one.
    if (channel === 'teams' && !can(access, 'alert.manage', { groupId: group }))
      throw new ForbiddenException(
        'Only an alert manager can send a test message to the Teams channel.',
      );
    const key = `${access.userId}:${channel}`;
    const last = this.lastTest.get(key);
    if (last !== undefined && now.getTime() - last < TEST_GAP_MS)
      throw new HttpException(
        'A test alert was sent a moment ago. Wait half a minute and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );

    const config = readAlertConfig();
    const result = (
      outcome: AlertTestResultDto['outcome'],
      message: string,
    ): AlertTestResultDto => ({ channel, outcome, message });

    const prepared = await this.tenant.run(ctxOf(access), async (trx) => {
      const settings = await this.settingsOf(trx, group);
      const mobile =
        channel === 'sms'
          ? ((
              await trx
                .selectFrom('alert_contacts')
                .select('mobile')
                .where('group_id', '=', group)
                .where('user_id', '=', access.userId)
                .executeTakeFirst()
            )?.mobile ?? null)
          : null;
      return { settings, mobile };
    });
    const enabled = {
      sms: prepared.settings.smsEnabled,
      teams: prepared.settings.teamsEnabled,
      email: prepared.settings.emailEnabled,
    }[channel];
    if (!config[channel])
      return result(
        'not_configured',
        `${CHANNEL_WORDS[channel]} is not set up on this server, so nothing was sent. Ask IT to set it up.`,
      );
    if (!enabled)
      return result(
        'disabled',
        `${CHANNEL_WORDS[channel]} alerts are switched off for this group, so nothing was sent.`,
      );
    if (channel === 'sms' && !prepared.mobile)
      return result('no_contact', 'You have not saved a mobile number yet, so no SMS was sent.');

    this.lastTest.set(key, now.getTime());
    const composed = composeTest(channel, linkTo('/incidents'));
    const target = channel === 'sms' ? prepared.mobile : channel === 'email' ? access.email : null;
    let error: string | null = null;
    try {
      await deliver(config, channel, target, composed, this.transportOptions);
    } catch (e) {
      error = e instanceof AlertSendError ? e.message : 'The alert could not be sent.';
    }
    await this.tenant.run(ctxOf(access), (trx) =>
      this.audit.record(trx, {
        action: error === null ? AuditActions.alertSent : AuditActions.alertFailed,
        actorUserId: access.userId,
        targetType: 'alert_test',
        targetId: access.userId,
        groupId: group,
        details: { test: true, channel, ...(error !== null && { error }) },
      }),
    );
    return error === null
      ? result('sent', `A test ${CHANNEL_WORDS[channel]} alert was sent.`)
      : result('failed', `The test ${CHANNEL_WORDS[channel]} alert could not be sent: ${error}`);
  }

  // ---------------------------------------------------------------------------------------------------
  // The outbox: written with the incident

  /**
   * Called from IncidentsService inside the incident's own transaction, when an incident is opened or its severity
   * changes. Writes the outbox rows (and nothing else), so a rolled-back incident leaves no alert behind. Returns how
   * many deliveries were written. An incident alerts when it reaches a severity above everything announced for it
   * so far; a channel that is switched off, or not configured on this server, creates no row.
   */
  async enqueueForIncident(trx: Trx, incident: AlertIncident): Promise<number> {
    const severity = incident.severity as IncidentSeverity;
    if (!isSevereIncident(severity)) return 0;
    const rank = rankOf(severity);
    const announced = await trx
      .selectFrom('alert_incident_dispatches')
      .select('id')
      .where('incident_id', '=', incident.id)
      .where('severity_rank', '>=', rank)
      .executeTakeFirst();
    if (announced) return 0;
    const marked = await trx
      .insertInto('alert_incident_dispatches')
      .values({ company_id: incident.company_id, incident_id: incident.id, severity_rank: rank })
      .onConflict((oc) => oc.columns(['incident_id', 'severity_rank']).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!marked) return 0;

    const company = await trx
      .selectFrom('companies')
      .select(['id', 'group_id', 'name'])
      .where('id', '=', incident.company_id)
      .executeTakeFirstOrThrow();
    const settings = await this.settingsOf(trx, company.group_id);
    if (rank === 2 && settings.minSeverity === 'critical') return 0;

    const config = readAlertConfig();
    const active = ALERT_CHANNELS.filter(
      (c) => config[c] !== null && settings[`${c}Enabled` as const],
    );
    if (active.length === 0) return 0;

    const facts: AlertFacts = {
      severity: severity as 'critical' | 'high',
      title: incident.title,
      companyName: company.name,
      link: linkTo(`/incidents/${incident.id}`),
    };
    const base = {
      company_id: company.id,
      group_id: company.group_id,
      incident_id: incident.id,
      severity: facts.severity,
    };
    const rows: {
      company_id: string;
      group_id: string;
      incident_id: string;
      severity: 'critical' | 'high';
      channel: AlertChannel;
      recipient_user_id: string | null;
      subject: string;
      body: string;
    }[] = [];

    if (active.includes('teams'))
      rows.push({
        ...base,
        channel: 'teams',
        recipient_user_id: null,
        ...composeAlert('teams', facts),
      });

    if (active.includes('sms') || active.includes('email')) {
      const people = await this.recipients(
        trx,
        company.id,
        severity as 'critical' | 'high',
        incident.opened_by,
      );
      const withMobile = new Set(
        people.length && active.includes('sms')
          ? (
              await trx
                .selectFrom('alert_contacts')
                .select('user_id')
                .where('group_id', '=', company.group_id)
                .where(
                  'user_id',
                  'in',
                  people.map((p) => p.user_id),
                )
                .execute()
            ).map((c) => c.user_id)
          : [],
      );
      for (const person of people) {
        if (active.includes('email'))
          rows.push({
            ...base,
            channel: 'email',
            recipient_user_id: person.user_id,
            ...composeAlert('email', facts),
          });
        // A person is reached by SMS only if they have a number.
        if (active.includes('sms') && withMobile.has(person.user_id))
          rows.push({
            ...base,
            channel: 'sms',
            recipient_user_id: person.user_id,
            ...composeAlert('sms', facts),
          });
      }
    }
    if (rows.length > 0) await trx.insertInto('alert_deliveries').values(rows).execute();
    return rows.length;
  }

  /** The people to alert for a severity: holders of its roles in the company or its group, and (SEV1) the incident owner. */
  private async recipients(
    trx: Trx,
    companyId: string,
    severity: 'critical' | 'high',
    ownerId: string,
  ): Promise<{ user_id: string; email: string; display_name: string }[]> {
    const roles = [...ALERT_ROLES[severity]];
    const owners = severity === 'critical' ? [ownerId] : [];
    const { rows } = await sql<{
      user_id: string;
      email: string;
      display_name: string;
    }>`select user_id, email, display_name from alert_recipients(${companyId}::uuid, ${sql.val(roles)}::text[], ${sql.val(owners)}::uuid[])`.execute(
      trx,
    );
    return rows;
  }

  // ---------------------------------------------------------------------------------------------------
  // The sweep job

  /** Safety net, then send what is due. The sweep calls this for every active company. */
  async sweepCompany(companyId: string, now: Date): Promise<void> {
    await this.enqueueMissed(companyId);
    await this.sendDue(companyId, now);
  }

  /**
   * An incident can be opened by code that does not know about alerts (the bypass check opens SEV2 incidents).
   * Any open incident at SEV1 or SEV2 that has not been announced at its severity is announced now.
   */
  private async enqueueMissed(companyId: string): Promise<void> {
    await this.tenant.run(systemCheckContext(companyId), async (trx) => {
      const missed = await trx
        .selectFrom('incidents as i')
        .select(['i.id', 'i.company_id', 'i.title', 'i.severity', 'i.opened_by'])
        .where('i.company_id', '=', companyId)
        .where('i.severity', 'in', ['high', 'critical'])
        .where('i.status', 'in', ['open', 'investigating'])
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('alert_incident_dispatches as d')
                .select('d.id')
                .whereRef('d.incident_id', '=', 'i.id')
                .where(
                  'd.severity_rank',
                  '>=',
                  sql<number>`case i.severity when 'critical' then 3 else 2 end`,
                ),
            ),
          ),
        )
        .execute();
      for (const incident of missed) await this.enqueueForIncident(trx, incident);
    });
  }

  /** Sends every pending delivery of the company that is due. Each row is claimed (and its next attempt time moved) BEFORE anything is sent. */
  async sendDue(companyId: string, now: Date): Promise<void> {
    const claimed = await this.claim(companyId, now);
    if (claimed.length === 0) return;
    const config = readAlertConfig();
    for (const item of claimed) {
      let error: string | null = null;
      let final = false;
      if (item.exhausted) {
        error = 'The last attempt did not finish (the server stopped during it).';
        final = true;
      } else if (!config[item.channel]) {
        error = `${CHANNEL_WORDS[item.channel]} is no longer configured on this server.`;
        final = true;
      } else if (item.channel !== 'teams' && !item.target) {
        error =
          item.channel === 'sms'
            ? 'The person no longer has a mobile number.'
            : 'The person is no longer an active member with an e-mail address.';
        final = true;
      } else {
        try {
          await deliver(config, item.channel, item.target, item, this.transportOptions);
        } catch (e) {
          error = e instanceof AlertSendError ? e.message : 'The alert could not be sent.';
        }
      }
      await this.settle(item, error, final || item.attempts >= ALERT_MAX_ATTEMPTS, now);
    }
  }

  private async claim(companyId: string, now: Date): Promise<Claimed[]> {
    return this.tenant.run(systemCheckContext(companyId), async (trx) => {
      const due = await trx
        .selectFrom('alert_deliveries')
        .select([
          'id',
          'company_id',
          'group_id',
          'incident_id',
          'channel',
          'recipient_user_id',
          'severity',
          'subject',
          'body',
          'attempts',
        ])
        .where('company_id', '=', companyId)
        .where('status', '=', 'pending')
        .where('next_attempt_at', '<=', now)
        .orderBy('next_attempt_at')
        .orderBy('id')
        .limit(50)
        .forUpdate()
        .skipLocked()
        .execute();
      const claimed: Claimed[] = [];
      for (const row of due) {
        if (row.attempts >= ALERT_MAX_ATTEMPTS) {
          claimed.push({ ...row, target: null, exhausted: true });
          continue;
        }
        const attempts = row.attempts + 1;
        const wait = ALERT_BACKOFF_MINUTES[Math.min(attempts, ALERT_BACKOFF_MINUTES.length) - 1]!;
        await trx
          .updateTable('alert_deliveries')
          .set({
            attempts,
            next_attempt_at: new Date(now.getTime() + wait * 60_000),
            updated_at: now,
          })
          .where('id', '=', row.id)
          .execute();
        claimed.push({ ...row, attempts, target: await this.targetOf(trx, row) });
      }
      return claimed;
    });
  }

  /** The number or address of a delivery's person, read now; the delivery row itself never stores either. */
  private async targetOf(
    trx: Trx,
    row: {
      channel: AlertChannel;
      company_id: string;
      group_id: string;
      recipient_user_id: string | null;
    },
  ): Promise<string | null> {
    if (row.channel === 'teams' || !row.recipient_user_id) return null;
    if (row.channel === 'sms') {
      const contact = await trx
        .selectFrom('alert_contacts')
        .select('mobile')
        .where('group_id', '=', row.group_id)
        .where('user_id', '=', row.recipient_user_id)
        .executeTakeFirst();
      return contact?.mobile ?? null;
    }
    const { rows } = await sql<{
      email: string;
    }>`select email from alert_recipients(${row.company_id}::uuid, '{}'::text[], ${sql.val([row.recipient_user_id])}::uuid[])`.execute(
      trx,
    );
    return rows[0]?.email ?? null;
  }

  /** Records the outcome of one attempt: sent, retry later, or failed for good (audited, and the alert managers are told). */
  private async settle(
    item: Claimed,
    error: string | null,
    final: boolean,
    now: Date,
  ): Promise<void> {
    await this.tenant.run(systemCheckContext(item.company_id), async (trx) => {
      const details = {
        deliveryId: item.id,
        channel: item.channel,
        severity: item.severity,
        attempts: item.attempts,
        ...(item.recipient_user_id && { recipientUserId: item.recipient_user_id }),
      };
      if (error === null) {
        await trx
          .updateTable('alert_deliveries')
          .set({ status: 'sent', sent_at: now, last_error: null, updated_at: now })
          .where('id', '=', item.id)
          .execute();
        await this.audit.record(trx, {
          action: AuditActions.alertSent,
          actorUserId: null,
          targetType: 'incident',
          targetId: item.incident_id,
          companyId: item.company_id,
          details,
        });
        return;
      }
      if (!final) {
        await trx
          .updateTable('alert_deliveries')
          .set({ last_error: error.slice(0, 300), updated_at: now })
          .where('id', '=', item.id)
          .execute();
        return;
      }
      await trx
        .updateTable('alert_deliveries')
        .set({ status: 'failed', last_error: error.slice(0, 300), updated_at: now })
        .where('id', '=', item.id)
        .execute();
      this.log.warn(
        `An alert by ${item.channel} failed for good after ${item.attempts} attempt(s).`,
      );
      const incident = await trx
        .selectFrom('incidents')
        .select('title')
        .where('id', '=', item.incident_id)
        .executeTakeFirst();
      await this.notifications.notifyHolders(trx, {
        companyId: item.company_id,
        groupId: item.group_id,
        permission: 'alert.manage',
        eventType: 'alert.delivery_failed',
        targetType: 'incident',
        targetId: item.incident_id,
        summary: `An alert by ${CHANNEL_WORDS[item.channel]} could not be delivered for the incident "${incident?.title ?? ''}" after ${item.attempts} attempt(s).`,
      });
      await this.audit.record(trx, {
        action: AuditActions.alertFailed,
        actorUserId: null,
        targetType: 'incident',
        targetId: item.incident_id,
        companyId: item.company_id,
        details: { ...details, error },
      });
    });
  }

  // ---------------------------------------------------------------------------------------------------
  // Scope helpers

  /** Which group a request is about: the one named (the caller must belong to it), or the caller's only group. */
  private groupFor(access: Access, groupId?: string): string {
    const groups = [...new Set(access.memberships.map((m) => m.groupId))];
    if (groupId) {
      if (!groups.includes(groupId))
        throw new ForbiddenException('You have no access to this group.');
      return groupId;
    }
    if (groups.length === 1) return groups[0]!;
    if (groups.length === 0) throw new ForbiddenException('You have no access here.');
    throw new BadRequestException('Say which group this is about (groupId).');
  }

  private mustManage(access: Access, groupId: string): void {
    if (!can(access, 'alert.manage', { groupId }))
      throw new ForbiddenException('You cannot manage alerts for this group.');
  }
}

const toSettingsDto = (r: {
  group_id: string;
  sms_enabled: boolean;
  teams_enabled: boolean;
  email_enabled: boolean;
  min_severity: 'critical' | 'high';
  updated_at: Date;
}): AlertSettingsDto => ({
  groupId: r.group_id,
  smsEnabled: r.sms_enabled,
  teamsEnabled: r.teams_enabled,
  emailEnabled: r.email_enabled,
  minSeverity: r.min_severity,
  updatedAt: r.updated_at.toISOString(),
});
