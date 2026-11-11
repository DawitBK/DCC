import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  CreateContentItemRequest,
  EditContentItemRequest,
  type ContentItemDto,
  type ContentItemWithVersionDto,
  type ContentVersionDto,
} from '@dcc/contracts';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { ContentService } from './content.service';

/**
 * H-04, first of 2-3 pull requests: drafts and versions only. Submit/review/approve/reject and the
 * ApprovalVerifier land in the next ones, once the placeholder approval rule (or Abenezer's A-05) is
 * in place.
 */
@Controller('content-items')
export class ContentController {
  constructor(private readonly content: ContentService) {}

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
}
