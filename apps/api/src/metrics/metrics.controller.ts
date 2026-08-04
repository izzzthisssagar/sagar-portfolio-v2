import { createHash, timingSafeEqual } from 'node:crypto';
import { Controller, Get, Headers, NotFoundException, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { getConfig } from '../config';
import { HealthService } from '../health/health.service';
import { renderPrometheusText } from './registry';

const METRICS_TOKEN_HEADER = 'x-metrics-token';

/** Constant-time comparison — a naive `===`/`!==` on secrets leaks their length and a
 * byte-by-byte timing signal an attacker can use to brute-force the token character by
 * character. Genuinely fixed-length, not just "same-shaped": both inputs are hashed with SHA-256
 * first (always a 32-byte digest, regardless of the input token's own length), so
 * `timingSafeEqual` always compares two 32-byte buffers — there is no branch on the presented
 * token's length anywhere in this function, and no length-derived control flow for an attacker's
 * timing to correlate against. `'utf8'` is explicit: a raw byte comparison of a Unicode token
 * would otherwise vary by encoding assumptions between the presented header value and the
 * configured secret. */
function safeTokenEquals(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a, 'utf8').digest();
  const digestB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * Internal-only Prometheus-format metrics — 404s (never 401/403, which would confirm the route
 * exists to an unauthenticated prober) unless `METRICS_ENABLED=true` and the caller presents a
 * valid `METRICS_TOKEN` via `x-metrics-token`. Deliberately never checks the admin session cookie
 * — a scraper is a machine-to-machine caller with its own credential, not a logged-in browser,
 * and accepting the admin cookie here would let a stolen admin session also read operational
 * metrics it has no legitimate reason to see. See docs/operations.md.
 */
@Controller('internal/metrics')
@ApiExcludeController()
@SkipThrottle()
export class MetricsController {
  constructor(private readonly health: HealthService) {}

  @Get() async get(@Headers(METRICS_TOKEN_HEADER) token: string | undefined, @Res() res: Response) {
    const config = getConfig();
    if (!config.METRICS_ENABLED || !config.METRICS_TOKEN) throw new NotFoundException();
    if (!token || !safeTokenEquals(token, config.METRICS_TOKEN)) throw new NotFoundException();

    const readiness = await this.health.readiness();
    res
      .status(200)
      .header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(renderPrometheusText(readiness.ok));
  }
}
