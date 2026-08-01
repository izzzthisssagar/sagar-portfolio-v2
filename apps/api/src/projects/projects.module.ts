import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { AdminGuard } from '../shared';
@Module({ controllers: [ProjectsController], providers: [ProjectsService, AdminGuard] })
export class ProjectsModule {}
