import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HealthController } from './shared';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ProjectsModule } from './projects/projects.module';
import { PostsModule } from './posts/posts.module';
import { MediaModule } from './media/media.module';
import { ProfileModule } from './profile/profile.module';
import { CvModule } from './cv/cv.module';
import { ContactModule } from './contact/contact.module';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';

/** The production default (60 req/60s/IP) is a real security control and must never be silently
 * loosened. `RATE_LIMIT_MAX` exists solely so CI/local e2e runs — which drive one shared IP
 * through a long, necessarily sequential Playwright suite (see playwright.config.ts) — can raise
 * this specific app instance's budget without touching the guarded default anywhere it matters.
 * Unset (production, and any environment that doesn't explicitly opt in) falls back to 60. */
function globalRateLimit(): number {
  const raw = process.env.RATE_LIMIT_MAX;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
}

@Module({
  imports: [
    PrismaModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: globalRateLimit() }]),
    AuthModule,
    ProjectsModule,
    PostsModule,
    MediaModule,
    ProfileModule,
    CvModule,
    ContactModule,
    DashboardModule,
    HealthModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
