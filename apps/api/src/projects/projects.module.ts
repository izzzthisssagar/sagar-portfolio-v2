import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminProjectsController, ProjectsController } from './projects.controller';
import { ProjectFindingsService } from './project-findings.service';
import { ProjectMetricsService } from './project-metrics.service';
import { ProjectsService } from './projects.service';
@Module({
  imports: [AuthModule],
  controllers: [ProjectsController, AdminProjectsController],
  providers: [ProjectsService, ProjectMetricsService, ProjectFindingsService],
  exports: [ProjectsService, ProjectMetricsService, ProjectFindingsService],
})
export class ProjectsModule {}
