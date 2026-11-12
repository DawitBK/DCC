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
import { GrantMembershipRequest, type MembershipRecordDto, type UserDto } from '@dcc/contracts';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { AccessGovernanceService } from './access-governance.service';

/** H-03: people and roles - "a new subsidiary onboarded in under a day without code changes." */
@Controller()
export class AccessGovernanceController {
  constructor(private readonly governance: AccessGovernanceService) {}

  @Get('users')
  @RequirePermission('user.read')
  listUsers(@CurrentAccess() access: Access): Promise<UserDto[]> {
    return this.governance.listUsers(access);
  }

  @Post('memberships')
  @HttpCode(201)
  @RequirePermission('user.manage')
  grant(
    @CurrentAccess() access: Access,
    @Body(new ZodValidationPipe(GrantMembershipRequest)) body: GrantMembershipRequest,
  ): Promise<MembershipRecordDto> {
    return this.governance.grant(access, body);
  }

  @Delete('memberships/:id')
  @HttpCode(204)
  @RequirePermission('user.manage')
  revoke(@CurrentAccess() access: Access, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.governance.revoke(access, id);
  }
}
