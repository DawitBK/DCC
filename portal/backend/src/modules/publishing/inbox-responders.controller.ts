import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  InboxRespondersQuery,
  SetInboxRespondersRequest,
  type InboxAssigneeDto,
  type InboxResponderDto,
} from '@dcc/contracts';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { InboxRespondersService } from './inbox-responders.service';

/** Round 3 (E-15, B-37): the primary and backup responders of a company, with their languages. */
@Controller('inbox/responders')
export class InboxRespondersController {
  constructor(private readonly responders: InboxRespondersService) {}

  @Get()
  @RequirePermission('inbox.read')
  list(
    @CurrentAccess() access: Access,
    @Query(new ZodValidationPipe(InboxRespondersQuery)) q: z.infer<typeof InboxRespondersQuery>,
  ): Promise<InboxResponderDto[]> {
    return this.responders.list(access, q.companyId);
  }

  /** The people who may be put on the list (whoever can reply for the company), for a manager who cannot reply. */
  @Get('candidates')
  @RequirePermission('inbox.manage')
  candidates(
    @CurrentAccess() access: Access,
    @Query(new ZodValidationPipe(InboxRespondersQuery)) q: z.infer<typeof InboxRespondersQuery>,
  ): Promise<InboxAssigneeDto[]> {
    return this.responders.candidates(access, q.companyId);
  }

  /** Replaces the whole list of one company (an empty list clears it). */
  @Put()
  @RequirePermission('inbox.manage')
  set(
    @CurrentAccess() access: Access,
    @Body(new ZodValidationPipe(SetInboxRespondersRequest)) body: SetInboxRespondersRequest,
  ): Promise<InboxResponderDto[]> {
    return this.responders.set(access, body);
  }
}
