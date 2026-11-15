import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  createParamDecorator,
  ExceptionFilter,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
  PipeTransform,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';
import type { ApiError } from '@dcc/contracts';
import type { Access } from '../authz/authz';
import { currentRequest } from '../observability/request-context';

/** The caller's resolved access, set by SessionGuard. */
export const CurrentAccess = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Access => {
    const access = ctx.switchToHttp().getRequest<Request>().access;
    if (!access)
      throw new Error('CurrentAccess used on a route without a session (is it marked @Public()?)');
    return access;
  },
);

/** Validates request bodies with the shared zod schemas from @dcc/contracts. */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}
  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie sessions: a state-changing request must come from the DCC web origin
 * (browsers always send Origin on POST/PUT/PATCH/DELETE). Together with SameSite=Lax cookies this
 * stops a malicious site from driving a signed-in user's session. The IdP's back-channel logout is a
 * server-to-server call authenticated by a signed token, so it is exempt.
 */
export function originCheckMiddleware(webOrigin: string) {
  const allowed = new URL(webOrigin).origin;
  return (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method) || req.path === '/api/auth/backchannel-logout') return next();
    let origin = req.header('origin');
    if (!origin) {
      const referer = req.header('referer');
      if (referer) {
        try {
          origin = new URL(referer).origin;
        } catch {
          /* ignore */
        }
      }
    }
    if (origin !== allowed) {
      const body: ApiError = {
        statusCode: 403,
        error: 'Forbidden',
        message: 'Cross-origin request refused.',
        requestId: currentRequest()?.requestId,
      };
      res.status(403).json(body);
      return;
    }
    next();
  };
}

/** One error shape for every failure. Internal errors are logged with the request id and never leak details. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = currentRequest()?.requestId;
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const message =
        typeof payload === 'string'
          ? payload
          : ((payload as { message?: unknown }).message ?? exception.message);
      const code =
        typeof payload === 'object' && payload ? (payload as { code?: unknown }).code : undefined;
      const body: ApiError & { issues?: unknown } = {
        statusCode: status,
        error: HttpStatus[status] ?? 'Error',
        message: Array.isArray(message) ? message.join('; ') : String(message),
        requestId,
        ...(typeof code === 'string' ? { code } : {}),
        ...(typeof payload === 'object' && payload && 'issues' in payload
          ? { issues: (payload as { issues: unknown }).issues }
          : {}),
      };
      res.status(status).json(body);
      return;
    }
    this.logger.error(
      `Unhandled error: ${(exception as Error)?.message}`,
      (exception as Error)?.stack,
    );
    const body: ApiError = {
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Something went wrong. Quote the request id to support.',
      requestId,
    };
    res.status(500).json(body);
  }
}
