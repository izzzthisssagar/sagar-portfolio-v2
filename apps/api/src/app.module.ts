import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { HealthController } from './shared';
import { AuthModule } from './auth/auth.module';
import { ProjectsModule } from './projects/projects.module';
@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]), AuthModule, ProjectsModule],
  controllers: [HealthController],
})
export class AppModule {}
