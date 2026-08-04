import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { resolveRequestId } from './logging/request-id';
import type { StructuredLogger } from './logging/structured-logger';

/** Optional — `configure-app.ts` passes the real `StructuredLogger`; every test harness that
 * constructs `new ErrorEnvelopeFilter()` directly (none currently do, but nothing requires one
 * to) still gets a working filter with a plain-console fallback instead of a runtime error. */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  constructor(private readonly logger?: StructuredLogger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const request = host.switchToHttp().getRequest<Request & { id?: string }>();
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    // The same id `requestIdMiddleware` already attached to this request (and echoed on the
    // response header) — never a freshly generated one, so a user who reports "requestId X" can
    // actually be correlated against the structured log line for that same request.
    const requestId = request.id ?? resolveRequestId(undefined);
    const raw =
      exception instanceof HttpException ? exception.getResponse() : 'Internal server error';
    // 429's default message from @nestjs/throttler is literally "ThrottlerException: Too Many
    // Requests" — the library's own exception class name leaking into a public message. The
    // Retry-After header (set by ThrottlerGuard itself) already carries the actual retry
    // guidance; the message only needs to say what happened, not name the internal class that
    // detected it.
    const message =
      status === 429
        ? 'Too many requests. Please try again later.'
        : typeof raw === 'string'
          ? raw
          : ((raw as { message?: string | string[] }).message ?? 'Request failed');
    const code =
      typeof raw === 'object' &&
      raw !== null &&
      typeof (raw as { code?: unknown }).code === 'string'
        ? (raw as { code: string }).code
        : `HTTP_${status}`;
    // Only the exception's own message/stack — never the raw exception object, which for a
    // non-HttpException (a driver error, a programming bug) could otherwise carry incidental
    // request data through unredacted fields.
    if (this.logger) {
      this.logger.logStructured(status >= 500 ? 'error' : 'warn', 'request_error', {
        requestId,
        method: request.method,
        route: request.route?.path ?? request.path,
        statusCode: status,
        code,
        ...(exception instanceof Error
          ? {
              errorMessage: exception.message,
              ...(status >= 500 ? { stack: exception.stack } : {}),
            }
          : {}),
      });
    } else if (status === 500) {
      console.error('Unhandled exception', exception);
    }
    response.status(status).json({ error: { code, message, requestId } });
  }
}
