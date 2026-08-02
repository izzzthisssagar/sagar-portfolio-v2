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
import { CreateProjectDto, ListProjectsDto, UpdateProjectDto } from './projects.dto';
import { ProjectsService } from './projects.service';

type AdminRequest = Request & { user?: AuthenticatedAdmin };
@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}
  @Get() list(@Query() query: ListProjectsDto) {
    return this.projects.list(query);
  }
  @Get(':id') async get(@Param('id') id: string) {
    return { data: await this.projects.get(id) };
  }
  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async create(@Body() input: CreateProjectDto, @Req() request: AdminRequest) {
    return { data: await this.projects.create(input, request.user?.sub) };
  }
  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async update(
    @Param('id') id: string,
    @Body() input: UpdateProjectDto,
    @Req() request: AdminRequest,
  ) {
    return { data: await this.projects.update(id, input, request.user?.sub) };
  }
  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async remove(@Param('id') id: string, @Req() request: AdminRequest) {
    await this.projects.remove(id, request.user?.sub);
    return { data: { deleted: true } };
  }
}
