import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import {
  AssignAccountRequest,
  CreateSocialAccountRequest,
  SetAccountBackupAdminRequest,
  SetAccountStatusRequest,
  UpdateSocialAccountRequest,
  type AccountAssignmentDto,
  type SocialAccountDto,
} from '@dcc/contracts';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { SocialAccountsService } from './social-accounts.service';

/** Optional filter for the registry-wide list of assignments. */
const AssignmentsQuery = z.object({ userId: z.uuid().optional() });

/**
 * H-02: the social account registry. FOUNDATION built the read-only list to prove tenant isolation
 * end to end; this module (Hirko) adds ownership, assignment and status governance on top of it.
 */
@Controller('social-accounts')
export class SocialAccountsController {
  constructor(private readonly accounts: SocialAccountsService) {}

  @Get()
  @RequirePermission('account.read')
  list(@CurrentAccess() access: Access): Promise<SocialAccountDto[]> {
    return this.accounts.list(access);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('account.manage')
  create(
    @CurrentAccess() access: Access,
    @Body(new ZodValidationPipe(CreateSocialAccountRequest)) body: CreateSocialAccountRequest,
  ): Promise<SocialAccountDto> {
    return this.accounts.create(access, body);
  }

  @Patch(':id')
  @RequirePermission('account.manage')
  update(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateSocialAccountRequest)) body: UpdateSocialAccountRequest,
  ): Promise<SocialAccountDto> {
    return this.accounts.update(access, id, body);
  }

  @Patch(':id/status')
  @RequirePermission('account.manage')
  setStatus(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(SetAccountStatusRequest)) body: SetAccountStatusRequest,
  ): Promise<SocialAccountDto> {
    return this.accounts.setStatus(access, id, body);
  }

  @Patch(':id/backup-admin')
  @RequirePermission('account.manage')
  setBackupAdmin(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(SetAccountBackupAdminRequest)) body: SetAccountBackupAdminRequest,
  ): Promise<SocialAccountDto> {
    return this.accounts.setBackupAdmin(access, id, body);
  }

  /**
   * Every assignment of every account the caller may manage, optionally for one person (`?userId=`): the registry-wide
   * view the people screens need ("which accounts is this person assigned to?") without one request per account.
   * The path has a different shape from `:id/assignments`, so the two never meet.
   */
  @Get('assignments')
  @RequirePermission('account.manage')
  allAssignments(
    @CurrentAccess() access: Access,
    @Query(new ZodValidationPipe(AssignmentsQuery)) q: z.infer<typeof AssignmentsQuery>,
  ): Promise<AccountAssignmentDto[]> {
    return this.accounts.allAssignments(access, q.userId);
  }

  @Get(':id/assignments')
  @RequirePermission('account.manage')
  assignments(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AccountAssignmentDto[]> {
    return this.accounts.assignments(access, id);
  }

  @Post(':id/assignments')
  @HttpCode(201)
  @RequirePermission('account.manage')
  assign(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(AssignAccountRequest)) body: AssignAccountRequest,
  ): Promise<AccountAssignmentDto> {
    return this.accounts.assign(access, id, body);
  }

  @Delete(':id/assignments/:userId')
  @HttpCode(204)
  @RequirePermission('account.manage')
  unassign(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.accounts.unassign(access, id, userId);
  }
}
