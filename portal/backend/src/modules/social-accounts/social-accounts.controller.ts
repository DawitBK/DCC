import { Controller, Get } from '@nestjs/common';
import type { SocialAccountDto } from '@dcc/contracts';
import { scopesWith, type Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { CurrentAccess } from '../../platform/http/http-support';
import { TenantDb } from '../../platform/tenancy/tenant-db';

const NIL = '00000000-0000-0000-0000-000000000000';

/**
 * FOUNDATION: read-only registry listing, there to prove tenant isolation end to end. Connecting,
 * assigning and governing accounts is Hirko's module (task H-02) and extends this folder.
 */
@Controller('social-accounts')
export class SocialAccountsController {
  constructor(private readonly tenant: TenantDb) {}

  @Get()
  @RequirePermission('account.read')
  async list(@CurrentAccess() access: Access): Promise<SocialAccountDto[]> {
    const scope = scopesWith(access, 'account.read');
    return this.tenant.run(
      { userId: access.userId, groupIds: access.groupIds, companyIds: access.companyIds },
      async (trx) => {
        // A group-level role reaches every company of the group; RLS bounds that to the caller's own groups.
        const groupCompanies = scope.groupIds.length
          ? (
              await trx
                .selectFrom('companies')
                .select('id')
                .where('group_id', 'in', scope.groupIds)
                .execute()
            ).map((c) => c.id)
          : [];
        const companyIds = [...new Set([...scope.companyIds, ...groupCompanies])];
        const rows = await trx
          .selectFrom('social_accounts')
          .select(['id', 'company_id', 'brand_id', 'platform', 'display_name', 'handle', 'status'])
          .where('company_id', 'in', companyIds.length ? companyIds : [NIL])
          .orderBy('display_name')
          .execute();
        return rows.map((r) => ({
          id: r.id,
          companyId: r.company_id,
          brandId: r.brand_id,
          platform: r.platform as SocialAccountDto['platform'],
          displayName: r.display_name,
          handle: r.handle,
          status: r.status,
        }));
      },
    );
  }
}
