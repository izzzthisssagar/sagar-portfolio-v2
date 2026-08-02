import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard, type AuthenticatedAdmin } from '../auth/jwt-auth.guard';
import {
  CreateProjectDto,
  ListProjectsDto,
  PublicListProjectsDto,
  UpdateProjectDto,
} from './projects.dto';
import { ProjectsService } from './projects.service';

type AdminRequest = Request & { user?: AuthenticatedAdmin };

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}
  @Get() list(@Query() query: PublicListProjectsDto) {
    return this.projects.listPublic(query);
  }
  @Get(':slug') async get(@Param('slug') slug: string) {
    return { data: await this.projects.getPublicBySlug(slug) };
  }
}

@ApiTags('admin/projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/projects')
export class AdminProjectsController {
  constructor(private readonly projects: ProjectsService) {}
  @Get() list(@Query() query: ListProjectsDto) {
    return this.projects.listAdmin(query);
  }
  @Get(':id') async get(@Param('id') id: string) {
    return { data: await this.projects.getAdmin(id) };
  }
  @Post() async create(@Body() input: CreateProjectDto, @Req() request: AdminRequest) {
    return { data: await this.projects.create(input, request.user?.sub) };
  }
  @Patch(':id') async update(
    @Param('id') id: string,
    @Body() input: UpdateProjectDto,
    @Req() request: AdminRequest,
  ) {
    return { data: await this.projects.update(id, input, request.user?.sub) };
  }
  @Delete(':id') async remove(@Param('id') id: string, @Req() request: AdminRequest) {
    await this.projects.remove(id, request.user?.sub);
    return { data: { deleted: true } };
  }
}
