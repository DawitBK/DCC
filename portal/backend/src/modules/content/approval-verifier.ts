import { Injectable } from '@nestjs/common';
import type {
  ApprovalDecision,
  ApprovalVerifier as ApprovalVerifierPort,
  PublishRequest,
} from '@dcc/engine-client';
import { TenantDb } from '../../platform/tenancy/tenant-db';

/**
 * RLS context for a company-scoped system check, not a signed-in person: app.user_id is not read by
 * any policy this class touches (content_items/content_versions/content_version_targets/
 * approval_requests only use app_company_allowed(company_id)), so no real user needs to "own" it.
 */
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

const notApproved = (reason: string): ApprovalDecision => ({ ok: false, reason });

/**
 * H-04 part 3: implements the interface `GovernedEngine` calls before it will ever publish anything
 * (`portal/engine-client/src/governed.ts`). Given a publish request, answers "is THIS exact content
 * version approved for THIS exact channel?" from Hirko's own tables - never trusts anything the
 * engine or the caller supplies beyond what is looked up here.
 *
 * Deliberately conservative: an older version that was approved before a later edit does NOT verify,
 * even though its approval_requests row still says 'approved' (H-04 step 6: a new version needs a new
 * approval). Only the content item's CURRENT version can ever pass.
 */
@Injectable()
export class ContentApprovalVerifier implements ApprovalVerifierPort {
  constructor(private readonly tenant: TenantDb) {}

  async verify(request: PublishRequest): Promise<ApprovalDecision> {
    return this.tenant.run(
      { userId: SYSTEM_USER_ID, groupIds: [], companyIds: [request.companyId] },
      async (trx) => {
        const item = await trx
          .selectFrom('content_items')
          .select(['id', 'company_id', 'current_version_id'])
          .where('id', '=', request.dccContentId)
          .where('company_id', '=', request.companyId)
          .executeTakeFirst();
        if (!item) return notApproved('Content item not found.');

        const version = await trx
          .selectFrom('content_versions')
          .select(['id'])
          .where('content_item_id', '=', item.id)
          .where('version_number', '=', request.approvalVersion)
          .executeTakeFirst();
        if (!version) return notApproved('That version does not exist.');

        if (item.current_version_id !== version.id)
          return notApproved('A newer version exists; this version is no longer current.');

        const account = await trx
          .selectFrom('social_accounts')
          .select(['id'])
          .where('engine_channel_id', '=', request.channelId)
          .where('company_id', '=', request.companyId)
          .executeTakeFirst();
        if (!account) return notApproved('Unknown channel.');

        const target = await trx
          .selectFrom('content_version_targets')
          .select(['id'])
          .where('content_version_id', '=', version.id)
          .where('social_account_id', '=', account.id)
          .executeTakeFirst();
        if (!target)
          return notApproved("This channel is not one of the version's approved targets.");

        const approval = await trx
          .selectFrom('approval_requests')
          .select(['status'])
          .where('content_version_id', '=', version.id)
          .executeTakeFirst();
        if (!approval || approval.status !== 'approved')
          return notApproved('This version is not approved.');

        return { ok: true };
      },
    );
  }
}
