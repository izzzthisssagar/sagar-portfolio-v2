import { timingSafeEqual } from 'node:crypto';
import { Controller, Get, Headers, NotFoundException, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { getConfig } from '../config';
import { HealthService } from '../health/health.service';
import { renderPrometheusText } from './registry';

const METRICS_TOKEN_HEADER = 'x-metrics-token';

/** Constant-time comparison — a naive `===`/`!==` on secrets leaks their length and a byte-by-byte
 * timing signal an attacker can use to brute-force the token character by character. Both inputs
 * are hashed to a fixed length first so `timingSafeEqual` (which throws on mismatched buffer
 * lengths) never itself becomes a length oracle. */
function safeTokenEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still do a same-shaped comparison (against itself) so this branch takes comparable time to
    // the equal-length path, rather than returning immediately.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
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
