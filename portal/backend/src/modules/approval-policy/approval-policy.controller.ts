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
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import {
  CreateContentCategoryRequest,
  SetApprovalPolicyRequest,
  UpdateContentCategoryRequest,
  type ApprovalPolicyDto,
  type ContentCategoryDto,
} from '@dcc/contracts';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission, RequireRecentAuth } from '../../platform/authz/decorators';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { ApprovalPolicyService } from './approval-policy.service';

const PolicyQuery = z.object({ companyId: z.uuid().optional() });

/** H-09: content categories and approval policies, maintained from the screens. */
@Controller()
export class ApprovalPolicyController {
  constructor(private readonly policies: ApprovalPolicyService) {}

  @Get('content-categories')
  @RequirePermission('content.read')
  listCategories(@CurrentAccess() access: Access): Promise<ContentCategoryDto[]> {
    return this.policies.listCategories(access);
  }

  @Post('content-categories')
  @HttpCode(201)
  @RequirePermission('approval_policy.manage')
  createCategory(
    @CurrentAccess() access: Access,
    @Body(new ZodValidationPipe(CreateContentCategoryRequest)) body: CreateContentCategoryRequest,
  ): Promise<ContentCategoryDto> {
    return this.policies.createCategory(access, body);
  }

  @Patch('content-categories/:id')
  @RequirePermission('approval_policy.manage')
  updateCategory(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateContentCategoryRequest)) body: UpdateContentCategoryRequest,
  ): Promise<ContentCategoryDto> {
    return this.policies.updateCategory(access, id, body);
  }

  @Get('approval-policies')
  @RequirePermission('content.read')
  listPolicies(
    @CurrentAccess() access: Access,
    @Query(new ZodValidationPipe(PolicyQuery)) q: z.infer<typeof PolicyQuery>,
  ): Promise<ApprovalPolicyDto[]> {
    return this.policies.listPolicies(access, q.companyId);
  }

  /** Changing who must approve is a sensitive action: it needs a recent sign-in. */
  @Put('approval-policies')
  @RequirePermission('approval_policy.manage')
  @RequireRecentAuth()
  setPolicy(
    @CurrentAccess() access: Access,
    @Body(new ZodValidationPipe(SetApprovalPolicyRequest)) body: SetApprovalPolicyRequest,
  ): Promise<ApprovalPolicyDto> {
    return this.policies.setPolicy(access, body);
  }

  @Delete('approval-policies/:id')
  @HttpCode(204)
  @RequirePermission('approval_policy.manage')
  @RequireRecentAuth()
  removePolicy(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.policies.removePolicy(access, id);
  }
}
