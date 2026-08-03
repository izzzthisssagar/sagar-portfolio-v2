import { Controller, Get, Headers, NotFoundException, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { getConfig } from '../config';
import { HealthService } from './health.service';

/**
 * Liveness and readiness are deliberately separate endpoints (not one endpoint with a query
 * param) so an orchestrator's two different probe configurations (frequent, cheap liveness;
 * less frequent, dependency-aware readiness) can point at two different, unambiguous URLs. See
 * docs/operations.md.
 *
 * Exempt from every rate-limit budget (`@SkipThrottle`) — an orchestrator's health probes are
 * infrastructure traffic, not user traffic, and must never compete with real requests for the
 * same budget or get themselves rate-limited into reporting a false outage.
 */
@ApiTags('health')
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live') live() {
    return this.health.liveness();
  }

  @Get('ready') async ready(@Res() res: Response) {
    const result = await this.health.readiness();
    res.status(result.ok ? 200 : 503).json(result);
  }

  /** Internal-only detail endpoint — 404s (not 401/403, which would confirm the route exists to
   * an unauthenticated prober) unless `HEALTH_INTERNAL_TOKEN` is configured and the caller
   * presents it via `x-health-token`. Never exposes hostnames, connection strings, or stack
   * traces — the same per-dependency ok/detail shape as `/ready`, nothing more. */
  @Get('details') async details(
    @Headers('x-health-token') token: string | undefined,
    @Res() res: Response,
  ) {
    const expected = getConfig().HEALTH_INTERNAL_TOKEN;
    if (!expected || token !== expected) throw new NotFoundException();
    const result = await this.health.readiness();
    res.status(result.ok ? 200 : 503).json({
      ...result,
      service: getConfig().SERVICE_NAME,
      releaseSha: getConfig().RELEASE_SHA,
    });
  }
}
