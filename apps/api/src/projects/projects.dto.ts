import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
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

export const PROJECT_STATUSES = ['draft', 'review', 'published', 'archived'] as const;
export class CreateProjectDto {
  @IsString() @MinLength(2) @MaxLength(120) title!: string;
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) slug!: string;
  @IsString() @MinLength(20) @MaxLength(500) summary!: string;
  @IsIn(PROJECT_STATUSES) status!: (typeof PROJECT_STATUSES)[number];
  @IsInt() @Min(0) @Max(10_000) order!: number;
}
export class UpdateProjectDto extends PartialType(CreateProjectDto) {}
export class ListProjectsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @IsIn(PROJECT_STATUSES) status?: (typeof PROJECT_STATUSES)[number];
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsIn(['order', 'title', 'createdAt']) sort = 'order';
  @IsOptional() @IsIn(['asc', 'desc']) direction: 'asc' | 'desc' = 'asc';
}
