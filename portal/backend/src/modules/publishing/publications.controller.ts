import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { PublishContentRequest, type PublicationDto } from '@dcc/contracts';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { PublicationsService } from './publications.service';

/** H-05: the real "sent before?" memory the approval door needs. */
@Controller()
export class PublicationsController {
  constructor(private readonly publications: PublicationsService) {}

  @Get('publications')
  @RequirePermission('content.read')
  list(@CurrentAccess() access: Access): Promise<PublicationDto[]> {
    return this.publications.list(access);
  }

  @Post('content-items/:id/publish')
  @HttpCode(201)
  @RequirePermission('content.publish')
  publish(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(PublishContentRequest)) body: PublishContentRequest,
  ): Promise<PublicationDto> {
    return this.publications.publish(access, id, body);
  }
}
