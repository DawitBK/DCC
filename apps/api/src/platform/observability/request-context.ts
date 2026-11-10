import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface RequestContext {
  requestId: string;
  ip?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const currentRequest = (): RequestContext | undefined => storage.getStore();

/** Gives every request a correlation id (honouring a sane inbound X-Request-Id) and makes it available everywhere. */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header('x-request-id');
  const requestId = inbound && /^[A-Za-z0-9._-]{8,64}$/.test(inbound) ? inbound : randomUUID();
  res.setHeader('X-Request-Id', requestId);
  storage.run({ requestId, ip: req.ip }, next);
}
