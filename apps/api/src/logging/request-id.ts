import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** A caller-supplied request id is only trusted if it looks like one — bounded length, a
 * conservative charset — so a request can't inject arbitrary bytes (log injection, absurd
 * header sizes) into every downstream log line just by setting a header. Anything else is
 * replaced with a freshly generated id rather than rejected outright, since a malformed value
 * here is a client bug, not a request the API needs to refuse. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;

export const REQUEST_ID_HEADER = 'x-request-id';

export function resolveRequestId(headerValue: unknown): string {
  if (typeof headerValue === 'string' && SAFE_REQUEST_ID.test(headerValue)) return headerValue;
  return randomUUID();
}

/** Attaches a request id to every request (accepting an already-valid caller-supplied one, e.g.
 * from an upstream proxy/load balancer, or generating a fresh one) and echoes it back on the
 * response — the same id a client can then quote back when reporting an issue, and the same id
 * every structured log line for this request carries. */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const id = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
  (req as Request & { id: string }).id = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}
