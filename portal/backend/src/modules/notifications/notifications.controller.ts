import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Access } from '../../platform/authz/authz';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { NotificationsService } from './notifications.service';

const Query_ = z.object({ unreadOnly: z.coerce.boolean().default(false) });

/**
 * A person's own in-app notifications. No @RequirePermission on purpose: this is a personal inbox,
 * open to anyone signed in - what each person sees is already restricted to their own rows by RLS.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentAccess() access: Access,
    @Query(new ZodValidationPipe(Query_)) q: z.infer<typeof Query_>,
  ) {
    return this.notifications.list(access, q.unreadOnly);
  }

  @Post(':id/read')
  markRead(@CurrentAccess() access: Access, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(access, id);
  }
}
