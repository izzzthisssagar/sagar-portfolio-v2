import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminProjectsController, ProjectsController } from './projects.controller';
import { ProjectEvidenceService } from './project-evidence.service';
import { ProjectFindingsService } from './project-findings.service';
import { ProjectMetricsService } from './project-metrics.service';
import { ProjectsService } from './projects.service';
@Module({
  imports: [AuthModule],
  controllers: [ProjectsController, AdminProjectsController],
  providers: [
    ProjectsService,
    ProjectMetricsService,
    ProjectFindingsService,
    ProjectEvidenceService,
  ],
  exports: [ProjectsService, ProjectMetricsService, ProjectFindingsService, ProjectEvidenceService],
})
export class ProjectsModule {}
