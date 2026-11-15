import { Controller, Get, Injectable, Module } from '@nestjs/common';
import type { SecurityPostureDto } from '@dcc/contracts';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { CurrentAccess } from '../../platform/http/http-support';
import { SecurityService } from './security.service';

/** H-10: the security overview for the Group CTO and security administrators. */
@Controller('security')
@Injectable()
export class SecurityController {
  constructor(private readonly security: SecurityService) {}

  @Get('posture')
  @RequirePermission('security.read')
  posture(@CurrentAccess() access: Access): Promise<SecurityPostureDto> {
    return this.security.posture(access);
  }
}

@Module({ controllers: [SecurityController], providers: [SecurityService] })
export class SecurityModule {}
