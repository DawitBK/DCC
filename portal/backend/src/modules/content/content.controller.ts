import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  ChangeContentCategoryRequest,
  CreateContentItemRequest,
  EditContentItemRequest,
  type ContentItemDto,
  type ContentItemWithVersionDto,
  type ContentVersionDto,
  type ApprovalRequestFullDto,
} from '@dcc/contracts';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { ApprovalsService } from './approvals.service';
import { ContentService } from './content.service';

/**
 * H-04: drafts, versions, and (part 2) submitting for review. Reviewing, approving and rejecting a
 * specific approval request live in ApprovalsController, under /approval-requests.
 */
@Controller('content-items')
export class ContentController {
  constructor(
    private readonly content: ContentService,
    private readonly approvals: ApprovalsService,
  ) {}

  @Get()
  @RequirePermission('content.read')
  list(@CurrentAccess() access: Access): Promise<ContentItemDto[]> {
    return this.content.list(access);
  }

  @Get(':id')
  @RequirePermission('content.read')
  get(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ContentItemDto> {
    return this.content.get(access, id);
  }

  @Get(':id/versions')
  @RequirePermission('content.read')
  versions(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ContentVersionDto[]> {
    return this.content.versions(access, id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('content.create')
  create(
    @CurrentAccess() access: Access,
    @Body(new ZodValidationPipe(CreateContentItemRequest)) body: CreateContentItemRequest,
  ): Promise<ContentItemWithVersionDto> {
    return this.content.create(access, body);
  }

  @Patch(':id')
  @RequirePermission('content.create')
  edit(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(EditContentItemRequest)) body: EditContentItemRequest,
  ): Promise<ContentItemWithVersionDto> {
    return this.content.edit(access, id, body);
  }

  @Get(':id/approval')
  @RequirePermission('content.read')
  getApproval(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApprovalRequestFullDto | null> {
    return this.approvals.get(access, id);
  }

  @Post(':id/submit')
  @HttpCode(201)
  @RequirePermission('content.submit')
  submit(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApprovalRequestFullDto> {
    return this.approvals.submit(access, id);
  }

  /**
   * Round 2 (C1-08): a reviewer or manager changes the category of an item that is in review, only to a stricter
   * one, with a written reason. The pending request takes the new rule and keeps the decisions already made.
   */
  @Post(':id/category')
  @HttpCode(201)
  @RequirePermission('content.review')
  changeCategory(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ChangeContentCategoryRequest)) body: ChangeContentCategoryRequest,
  ): Promise<ApprovalRequestFullDto> {
    return this.approvals.changeCategory(access, id, body);
  }
}
