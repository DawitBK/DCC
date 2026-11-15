import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import {
  LinkEngineChannelRequest,
  type EngineChannelDto,
  type EngineStatusDto,
  type SocialAccountDto,
} from '@dcc/contracts';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { EngineService } from './engine.service';

/** What the operational engine is and which of its channels belong to which registered account. */
@Controller()
export class EngineController {
  constructor(private readonly engine: EngineService) {}

  /** Which engine is behind DCC, whether it was verified against a live service, what it can do. */
  @Get('engine/status')
  @RequirePermission('account.read')
  status(): EngineStatusDto {
    return this.engine.status();
  }

  @Get('engine/channels')
  @RequirePermission('account.manage')
  channels(@CurrentAccess() access: Access): Promise<EngineChannelDto[]> {
    return this.engine.channels(access);
  }

  /** Link (or, with `engineChannelId: null`, unlink) a registered account and an engine channel. */
  @Patch('social-accounts/:id/engine-channel')
  @RequirePermission('account.manage')
  link(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(LinkEngineChannelRequest)) body: LinkEngineChannelRequest,
  ): Promise<Pick<SocialAccountDto, 'id' | 'engineChannelId'>> {
    return this.engine.link(access, id, body);
  }
}
