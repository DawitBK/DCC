import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { SetWorkingHoursRequest, WorkingHoursDto } from '@dcc/contracts';
import { sql, type Transaction } from 'kysely';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import { can, type Access } from '../../platform/authz/authz';
import type { DB } from '../../platform/database/schema';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { ctxOf } from '../shared/tenant-scope';
import { DEFAULT_CALENDAR, type WorkingCalendar } from '../shared/working-time';

/**
 * Round 2 base: the working calendar of a company (sheet C1-09, C1-10, E-12). Features that count in
 * working time (inbox clock, approval reminders, post-incident review) ask `calendarOf` inside their own
 * transaction. No row = the default calendar (ASM-24), never an error.
 */
@Injectable()
export class WorkingHoursService {
  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
  ) {}

  async calendarOf(trx: Transaction<DB>, companyId: string): Promise<WorkingCalendar> {
    const row = await trx
      .selectFrom('company_working_hours')
      .select([
        'work_days',
        'start_minute',
        'end_minute',
        'utc_offset_minutes',
        // Dates as text: the driver would turn a `date` into a Date at LOCAL midnight and shift the day.
        sql<
          string[]
        >`(select coalesce(array_agg(to_char(h, 'YYYY-MM-DD') order by h), '{}') from unnest(holidays) as h)`.as(
          'holidays',
        ),
      ])
      .where('company_id', '=', companyId)
      .executeTakeFirst();
    if (!row) return DEFAULT_CALENDAR;
    return {
      workDays: row.work_days,
      startMinute: row.start_minute,
      endMinute: row.end_minute,
      utcOffsetMinutes: row.utc_offset_minutes,
      holidays: row.holidays,
    };
  }

  async get(access: Access, companyId: string): Promise<WorkingHoursDto> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const company = await trx
        .selectFrom('companies')
        .select(['id', 'group_id'])
        .where('id', '=', companyId)
        .executeTakeFirst();
      if (!company) throw new NotFoundException('Company not found.');
      if (!can(access, 'company.read', { groupId: company.group_id, companyId: company.id }))
        throw new ForbiddenException('You cannot read this company.');
      return this.dto(trx, companyId);
    });
  }

  async set(access: Access, input: SetWorkingHoursRequest): Promise<WorkingHoursDto> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const company = await trx
        .selectFrom('companies')
        .select(['id', 'group_id'])
        .where('id', '=', input.companyId)
        .executeTakeFirst();
      if (!company) throw new NotFoundException('Company not found.');
      if (!can(access, 'inbox.manage', { groupId: company.group_id, companyId: company.id }))
        throw new ForbiddenException('You cannot change the working hours of this company.');
      const before = await this.dto(trx, company.id);
      const values = {
        work_days: [...new Set(input.workDays)].sort((a, b) => a - b),
        start_minute: input.startMinute,
        end_minute: input.endMinute,
        utc_offset_minutes: input.utcOffsetMinutes,
        holidays: sql<Date[]>`${[...new Set(input.holidays)].sort()}::date[]`,
        updated_by: access.userId,
        updated_at: new Date(),
      };
      await trx
        .insertInto('company_working_hours')
        .values({ company_id: company.id, ...values })
        .onConflict((oc) => oc.column('company_id').doUpdateSet(values))
        .execute();
      const after = await this.dto(trx, company.id);
      await this.audit.record(trx, {
        action: AuditActions.workingHoursSet,
        actorUserId: access.userId,
        targetType: 'company',
        targetId: company.id,
        companyId: company.id,
        details: { from: omitDates(before), to: omitDates(after) },
      });
      return after;
    });
  }

  private async dto(trx: Transaction<DB>, companyId: string): Promise<WorkingHoursDto> {
    const row = await trx
      .selectFrom('company_working_hours')
      .select(['updated_at'])
      .where('company_id', '=', companyId)
      .executeTakeFirst();
    const cal = await this.calendarOf(trx, companyId);
    return {
      companyId,
      workDays: [...cal.workDays],
      startMinute: cal.startMinute,
      endMinute: cal.endMinute,
      utcOffsetMinutes: cal.utcOffsetMinutes,
      holidays: [...cal.holidays],
      custom: row !== undefined,
      updatedAt: row ? row.updated_at.toISOString() : null,
    };
  }
}

const omitDates = ({ updatedAt: _updatedAt, ...rest }: WorkingHoursDto) => rest;
