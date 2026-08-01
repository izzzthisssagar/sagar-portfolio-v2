import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AdminGuard } from '../shared';
import { ProjectsService } from './projects.service';
class ProjectDto {
  @IsString() @MinLength(2) @MaxLength(120) title!: string;
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) slug!: string;
  @IsString() @MinLength(20) @MaxLength(500) summary!: string;
  @IsIn(['draft', 'review', 'published', 'archived']) status!:
    | 'draft'
    | 'review'
    | 'published'
    | 'archived';
  @IsInt() @Min(0) @Max(10_000) order!: number;
}
class ListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @IsIn(['draft', 'review', 'published', 'archived']) status?: string;
}
@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}
  @Get() list(@Query() query: ListQuery) {
    const filtered = this.projects.list().filter((p) => !query.status || p.status === query.status);
    const start = (query.page - 1) * query.limit;
    return {
      data: filtered.slice(start, start + query.limit),
      meta: { page: query.page, limit: query.limit, total: filtered.length },
    };
  }
  @Get(':id') get(@Param('id') id: string) {
    return { data: this.projects.get(id) };
  }
  @Post() @UseGuards(AdminGuard) @ApiBearerAuth() create(@Body() input: ProjectDto) {
    return { data: this.projects.create(input) };
  }
  @Patch(':id') @UseGuards(AdminGuard) @ApiBearerAuth() update(
    @Param('id') id: string,
    @Body() input: Partial<ProjectDto>,
  ) {
    return { data: this.projects.update(id, input) };
  }
  @Delete(':id') @UseGuards(AdminGuard) @ApiBearerAuth() remove(@Param('id') id: string) {
    this.projects.remove(id);
    return { data: { deleted: true } };
  }
}
