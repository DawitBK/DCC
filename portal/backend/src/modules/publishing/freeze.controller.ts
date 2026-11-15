import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CreateFreezeRequest, type FreezeDto } from '@dcc/contracts';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission, RequireRecentAuth } from '../../platform/authz/decorators';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { FreezeService } from './freeze.service';

/** H-05 (FR-15): the emergency freeze switch, per company or per account. */
@Controller('publishing-freezes')
export class FreezeController {
  constructor(private readonly freezes: FreezeService) {}

  @Get()
  @RequirePermission('publishing.freeze')
  list(@CurrentAccess() access: Access): Promise<FreezeDto[]> {
    return this.freezes.list(access);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('publishing.freeze')
  freeze(
    @CurrentAccess() access: Access,
    @Body(new ZodValidationPipe(CreateFreezeRequest)) body: CreateFreezeRequest,
  ): Promise<FreezeDto> {
    return this.freezes.freeze(access, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('publishing.freeze')
  // Freezing is the emergency brake and must be instant; LIFTING it is the sensitive direction.
  @RequireRecentAuth()
  unfreeze(@CurrentAccess() access: Access, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.freezes.unfreeze(access, id);
  }
}
