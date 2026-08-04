import { Module } from '@nestjs/common';
import { HealthModule } from '../health/health.module';
import { MetricsController } from './metrics.controller';

@Module({
  imports: [HealthModule],
  controllers: [MetricsController],
})
export class MetricsModule {}
