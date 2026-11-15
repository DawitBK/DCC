import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  BrandDto,
  CompanyDto,
  CreateBrandRequest,
  CreateCompanyRequest,
  UpdateBrandRequest,
  UpdateCompanyRequest,
} from '@dcc/contracts';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import { can, scopesWith, type Access } from '../../platform/authz/authz';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { ctxOf, NIL } from '../shared/tenant-scope';

const uniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505';

/**
 * FOUNDATION EXAMPLE (owner after hand-over: Hirko). It shows the pattern every module follows:
 *   1. the controller declares a coarse permission;
 *   2. the service runs ALL queries inside TenantDb.run() so PostgreSQL RLS applies;
 *   3. the service re-checks the permission for the specific company with authz.can();
 *   4. state changes write an audit event in the same transaction.
 */
@Injectable()
export class CompaniesService {
  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
  ) {}

  async list(access: Access): Promise<CompanyDto[]> {
    const scope = scopesWith(access, 'company.read');
    return this.tenant.run(ctxOf(access), async (trx) => {
      const rows = await trx
        .selectFrom('companies')
        .select(['id', 'group_id', 'name', 'slug', 'status'])
        .where((eb) =>
          eb.or([
            eb('id', 'in', scope.companyIds.length ? scope.companyIds : [NIL]),
            eb('group_id', 'in', scope.groupIds.length ? scope.groupIds : [NIL]),
          ]),
        )
        .orderBy('name')
        .execute();
      return rows.map(toCompany);
    });
  }

  async create(access: Access, input: CreateCompanyRequest): Promise<CompanyDto> {
    // A company is created inside a group the caller administers. (Today there is one group.)
    const groupId = scopesWith(access, 'company.manage').groupIds[0];
    if (!groupId) throw new ForbiddenException('Only a group administrator can create a company.');
    try {
      return await this.tenant.run(ctxOf(access), async (trx) => {
        const row = await trx
          .insertInto('companies')
          .values({ group_id: groupId, name: input.name, slug: input.slug, updated_at: new Date() })
          .returning(['id', 'group_id', 'name', 'slug', 'status'])
          .executeTakeFirstOrThrow();
        await this.audit.record(trx, {
          action: AuditActions.companyCreated,
          actorUserId: access.userId,
          targetType: 'company',
          targetId: row.id,
          companyId: row.id,
          details: { name: row.name, slug: row.slug },
        });
        return toCompany(row);
      });
    } catch (error) {
      if (uniqueViolation(error))
        throw new ConflictException('A company with that slug already exists.');
      throw error;
    }
  }

  /** Rename, suspend, archive or re-activate a company. Group level only (`company.manage`). Nothing is deleted. */
  async update(
    access: Access,
    companyId: string,
    input: UpdateCompanyRequest,
  ): Promise<CompanyDto> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const current = await trx
        .selectFrom('companies')
        .select(['id', 'group_id', 'name', 'slug', 'status'])
        .where('id', '=', companyId)
        .executeTakeFirst();
      if (!current) throw new NotFoundException('Company not found.');
      if (!can(access, 'company.manage', { groupId: current.group_id, companyId }))
        throw new ForbiddenException('You cannot change this company.');
      const row = await trx
        .updateTable('companies')
        .set({
          name: input.name ?? current.name,
          status: input.status ?? current.status,
          updated_at: new Date(),
        })
        .where('id', '=', companyId)
        .returning(['id', 'group_id', 'name', 'slug', 'status'])
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, {
        action: AuditActions.companyUpdated,
        actorUserId: access.userId,
        targetType: 'company',
        targetId: companyId,
        companyId,
        details: {
          name: { from: current.name, to: row.name },
          status: { from: current.status, to: row.status },
        },
      });
      return toCompany(row);
    });
  }

  async updateBrand(
    access: Access,
    companyId: string,
    brandId: string,
    input: UpdateBrandRequest,
  ): Promise<BrandDto> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const company = await this.visibleCompany(trx, companyId);
      if (!can(access, 'brand.manage', { groupId: company.group_id, companyId }))
        throw new ForbiddenException('You cannot manage brands of this company.');
      const current = await trx
        .selectFrom('brands')
        .select(['id', 'name'])
        .where('id', '=', brandId)
        .where('company_id', '=', companyId)
        .executeTakeFirst();
      if (!current) throw new NotFoundException('Brand not found.');
      const row = await trx
        .updateTable('brands')
        .set({ name: input.name })
        .where('id', '=', brandId)
        .returning(['id', 'company_id', 'name', 'slug'])
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, {
        action: AuditActions.brandUpdated,
        actorUserId: access.userId,
        targetType: 'brand',
        targetId: brandId,
        companyId,
        details: { name: { from: current.name, to: row.name } },
      });
      return { id: row.id, companyId: row.company_id, name: row.name, slug: row.slug };
    });
  }

  async listBrands(access: Access, companyId: string): Promise<BrandDto[]> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const company = await this.visibleCompany(trx, companyId);
      if (!can(access, 'brand.read', { groupId: company.group_id, companyId }))
        throw new ForbiddenException('You cannot view brands of this company.');
      const rows = await trx
        .selectFrom('brands')
        .select(['id', 'company_id', 'name', 'slug'])
        .where('company_id', '=', companyId)
        .orderBy('name')
        .execute();
      return rows.map((r) => ({ id: r.id, companyId: r.company_id, name: r.name, slug: r.slug }));
    });
  }

  async createBrand(
    access: Access,
    companyId: string,
    input: CreateBrandRequest,
  ): Promise<BrandDto> {
    try {
      return await this.tenant.run(ctxOf(access), async (trx) => {
        const company = await this.visibleCompany(trx, companyId);
        if (!can(access, 'brand.manage', { groupId: company.group_id, companyId }))
          throw new ForbiddenException('You cannot manage brands of this company.');
        const row = await trx
          .insertInto('brands')
          .values({ company_id: companyId, name: input.name, slug: input.slug })
          .returning(['id', 'company_id', 'name', 'slug'])
          .executeTakeFirstOrThrow();
        await this.audit.record(trx, {
          action: AuditActions.brandCreated,
          actorUserId: access.userId,
          targetType: 'brand',
          targetId: row.id,
          companyId,
          details: { name: row.name },
        });
        return { id: row.id, companyId: row.company_id, name: row.name, slug: row.slug };
      });
    } catch (error) {
      if (uniqueViolation(error))
        throw new ConflictException('A brand with that slug already exists in this company.');
      throw error;
    }
  }

  /** RLS hides companies the caller cannot see, so "not found" and "not yours" look identical (no existence leak). */
  private async visibleCompany(
    trx: Parameters<Parameters<TenantDb['run']>[1]>[0],
    companyId: string,
  ) {
    const company = await trx
      .selectFrom('companies')
      .select(['id', 'group_id'])
      .where('id', '=', companyId)
      .executeTakeFirst();
    if (!company) throw new NotFoundException('Company not found.');
    return company;
  }
}

const toCompany = (r: {
  id: string;
  group_id: string;
  name: string;
  slug: string;
  status: CompanyDto['status'];
}): CompanyDto => ({
  id: r.id,
  groupId: r.group_id,
  name: r.name,
  slug: r.slug,
  status: r.status,
});
