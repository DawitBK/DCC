import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { RecordIncidentReviewRequest, type IncidentReviewDto } from '@dcc/contracts';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { IncidentReviewService } from './incident-review.service';

/** D2-23: the post-incident review. PUT records it, or corrects it while the incident is not closed. */
@Controller('incidents/:id/review')
export class IncidentReviewController {
  constructor(private readonly reviews: IncidentReviewService) {}

  @Put()
  @HttpCode(200)
  @RequirePermission('incident.manage')
  record(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(RecordIncidentReviewRequest)) body: RecordIncidentReviewRequest,
  ): Promise<IncidentReviewDto> {
    return this.reviews.record(access, id, body);
  }
}
