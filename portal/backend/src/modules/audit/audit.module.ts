import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';

/** Read side of the audit trail (search, export, chain verification). Writing stays in the platform's AuditService. */
@Module({ controllers: [AuditController] })
export class AuditModule {}
