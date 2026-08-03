import type { NextFunction, Request, Response } from 'express';
import type { StructuredLogger } from './structured-logger';

interface RequestExtras {
  id?: string;
  route?: { path?: string };
}

/** One structured log line per completed request — logged on `finish` (after the response has
 * actually been sent), never before, so `statusCode` and `durationMs` reflect what really
 * happened rather than what was about to happen. Route uses the matched Express route template
 * (`/api/v1/projects/:id`, not `/api/v1/projects/cmx7f2...`) where available, falling back to the
 * raw path for anything that never matched a route (a 404) — never the query string, which can
 * carry values that don't belong in a log line. */
export function createAccessLogMiddleware(logger: StructuredLogger) {
  return function accessLogMiddleware(req: Request, res: Response, next: NextFunction): void {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      const withId = req as unknown as RequestExtras;
      logger.logStructured('info', 'http_request', {
        requestId: withId.id,
        method: req.method,
        route: withId.route?.path ?? req.path,
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      });
    });
    next();
  };
}
