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
import { type AdminRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CsrfGuard } from '../auth/csrf.guard';
import { CreateProjectEvidenceDto, UpdateProjectEvidenceDto } from './project-evidence.dto';
import { ProjectEvidenceService } from './project-evidence.service';
import { ProjectFindingsService } from './project-findings.service';
import { ProjectMetricsService } from './project-metrics.service';
import {
  CreateProjectDto,
  CreateProjectFindingDto,
  CreateProjectMetricDto,
  ListProjectsDto,
  ProjectWorkflowDto,
  PublicListProjectsDto,
  ReorderDto,
  UpdateProjectDto,
  UpdateProjectFindingDto,
  UpdateProjectMetricDto,
} from './projects.dto';
import { ProjectsService } from './projects.service';

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
@UseGuards(JwtAuthGuard, CsrfGuard)
@Controller('admin/projects')
export class AdminProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly metrics: ProjectMetricsService,
    private readonly findings: ProjectFindingsService,
    private readonly evidence: ProjectEvidenceService,
  ) {}

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
  @Post(':id/workflow') async workflow(
    @Param('id') id: string,
    @Body() input: ProjectWorkflowDto,
    @Req() request: AdminRequest,
  ) {
    return { data: await this.projects.transitionStatus(id, input.transition, request.user?.sub) };
  }
  @Delete(':id') async remove(@Param('id') id: string, @Req() request: AdminRequest) {
    await this.projects.remove(id, request.user?.sub);
    return { data: { deleted: true } };
  }

  @Get(':projectId/metrics') async listMetrics(@Param('projectId') projectId: string) {
    return { data: await this.metrics.list(projectId) };
  }
  @Post(':projectId/metrics') async createMetric(
    @Param('projectId') projectId: string,
    @Body() input: CreateProjectMetricDto,
    @Req() request: AdminRequest,
  ) {
    return { data: await this.metrics.create(projectId, input, request.user?.sub) };
  }
  @Patch(':projectId/metrics/reorder') async reorderMetrics(
    @Param('projectId') projectId: string,
    @Body() input: ReorderDto,
    @Req() request: AdminRequest,
  ) {
    await this.metrics.reorder(projectId, input.orderedIds, request.user?.sub);
    return { data: { reordered: true } };
  }
  @Patch(':projectId/metrics/:metricId') async updateMetric(
    @Param('projectId') projectId: string,
    @Param('metricId') metricId: string,
    @Body() input: UpdateProjectMetricDto,
    @Req() request: AdminRequest,
  ) {
    return { data: await this.metrics.update(projectId, metricId, input, request.user?.sub) };
  }
  @Delete(':projectId/metrics/:metricId') async removeMetric(
    @Param('projectId') projectId: string,
    @Param('metricId') metricId: string,
    @Req() request: AdminRequest,
  ) {
    await this.metrics.remove(projectId, metricId, request.user?.sub);
    return { data: { deleted: true } };
  }

  @Get(':projectId/findings') async listFindings(@Param('projectId') projectId: string) {
    return { data: await this.findings.list(projectId) };
  }
  @Post(':projectId/findings') async createFinding(
    @Param('projectId') projectId: string,
    @Body() input: CreateProjectFindingDto,
    @Req() request: AdminRequest,
  ) {
    return { data: await this.findings.create(projectId, input, request.user?.sub) };
  }
  @Patch(':projectId/findings/reorder') async reorderFindings(
    @Param('projectId') projectId: string,
    @Body() input: ReorderDto,
    @Req() request: AdminRequest,
  ) {
    await this.findings.reorder(projectId, input.orderedIds, request.user?.sub);
    return { data: { reordered: true } };
  }
  @Patch(':projectId/findings/:findingId') async updateFinding(
    @Param('projectId') projectId: string,
    @Param('findingId') findingId: string,
    @Body() input: UpdateProjectFindingDto,
    @Req() request: AdminRequest,
  ) {
    return { data: await this.findings.update(projectId, findingId, input, request.user?.sub) };
  }
  @Delete(':projectId/findings/:findingId') async removeFinding(
    @Param('projectId') projectId: string,
    @Param('findingId') findingId: string,
    @Req() request: AdminRequest,
  ) {
    await this.findings.remove(projectId, findingId, request.user?.sub);
    return { data: { deleted: true } };
  }

  @Get(':projectId/evidence') async listEvidence(@Param('projectId') projectId: string) {
    return { data: await this.evidence.list(projectId) };
  }
  @Post(':projectId/evidence') async createEvidence(
    @Param('projectId') projectId: string,
    @Body() input: CreateProjectEvidenceDto,
    @Req() request: AdminRequest,
  ) {
    return { data: await this.evidence.create(projectId, input, request.user?.sub) };
  }
  @Patch(':projectId/evidence/reorder') async reorderEvidence(
    @Param('projectId') projectId: string,
    @Body() input: ReorderDto,
    @Req() request: AdminRequest,
  ) {
    await this.evidence.reorder(projectId, input.orderedIds, request.user?.sub);
    return { data: { reordered: true } };
  }
  @Patch(':projectId/evidence/:evidenceId') async updateEvidence(
    @Param('projectId') projectId: string,
    @Param('evidenceId') evidenceId: string,
    @Body() input: UpdateProjectEvidenceDto,
    @Req() request: AdminRequest,
  ) {
    return { data: await this.evidence.update(projectId, evidenceId, input, request.user?.sub) };
  }
  @Delete(':projectId/evidence/:evidenceId') async removeEvidence(
    @Param('projectId') projectId: string,
    @Param('evidenceId') evidenceId: string,
    @Req() request: AdminRequest,
  ) {
    await this.evidence.remove(projectId, evidenceId, request.user?.sub);
    return { data: { deleted: true } };
  }
}
