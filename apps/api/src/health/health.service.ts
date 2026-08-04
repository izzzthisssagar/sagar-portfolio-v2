import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  MEDIA_STORAGE,
  type MediaStorageAdapter,
} from '../media/storage/storage-adapter.interface';

export interface DependencyCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface ReadinessResult {
  ok: boolean;
  checks: DependencyCheck[];
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorageAdapter,
  ) {}

  /** Confirms only that the process's own event loop is responsive — no dependency I/O, so an
   * outage in PostgreSQL, storage, or SMTP never makes liveness fail. A liveness probe that
   * depends on external services causes an orchestrator to kill and restart a perfectly healthy
   * process during someone else's outage, which only makes the outage worse. */
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  async readiness(): Promise<ReadinessResult> {
    const checks = await Promise.all([
      this.checkDatabase(),
      this.checkStorage(),
      this.checkNotificationConfig(),
    ]);
    return { ok: checks.every((c) => c.ok), checks };
  }

  private async checkDatabase(): Promise<DependencyCheck> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { name: 'database', ok: true };
    } catch {
      // Never includes the driver's own error (can embed the connection string/host) — only
      // that the dependency is unavailable.
      return { name: 'database', ok: false, detail: 'unavailable' };
    }
  }

  private async checkStorage(): Promise<DependencyCheck> {
    try {
      const result = await this.storage.ping();
      return { name: 'storage', ok: result.ok, ...(result.ok ? {} : { detail: 'unavailable' }) };
    } catch {
      return { name: 'storage', ok: false, detail: 'unavailable' };
    }
  }

  /** Never sends real mail — only confirms the current configuration is internally consistent (an
   * SMTP driver selection actually carries every field SMTP delivery needs). Reads `process.env`
   * directly rather than the cached `getConfig()` singleton: this mirrors the same fail-closed
   * rule `notification.module.ts` enforces at startup, but re-checked live on every readiness
   * probe rather than trusting a value cached once at boot. */
  private checkNotificationConfig(): DependencyCheck {
    const driver = process.env.CONTACT_NOTIFICATION_DRIVER;
    if (driver !== 'smtp') return { name: 'notification-config', ok: true };
    const required = [
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USERNAME',
      'SMTP_PASSWORD',
      'SMTP_FROM',
      'CONTACT_NOTIFICATION_TO',
    ];
    const ok = required.every((key) => Boolean(process.env[key]));
    return {
      name: 'notification-config',
      ok,
      ...(ok ? {} : { detail: 'incomplete configuration' }),
    };
  }
}
