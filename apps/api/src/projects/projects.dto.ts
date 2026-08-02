import { OmitType, PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
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
export const SCENE_STATES = [
  'sealed',
  'exploded',
  'mastery',
  'inspection',
  'fault',
  'verified',
  'rift',
] as const;
export const WORKFLOW_TRANSITIONS = ['draft', 'review', 'publish', 'archive'] as const;
export type WorkflowTransition = (typeof WORKFLOW_TRANSITIONS)[number];

export class CreateProjectDto {
  @IsString() @MinLength(2) @MaxLength(120) title!: string;
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) slug!: string;
  @IsString() @MinLength(20) @MaxLength(500) summary!: string;
  @IsOptional() @IsString() @MaxLength(6000) overview?: string;
  @IsOptional() @IsString() @MaxLength(6000) context?: string;
  @IsOptional() @IsString() @MaxLength(6000) responsibilities?: string;
  @IsOptional() @IsString() @MaxLength(6000) systemMap?: string;
  @IsOptional() @IsString() @MaxLength(6000) testStrategy?: string;
  @IsOptional() @IsString() @MaxLength(6000) fixAndRetest?: string;
  @IsOptional() @IsString() @MaxLength(6000) outcome?: string;
  @IsOptional() @IsString() @MaxLength(6000) lessons?: string;
  @IsOptional() @IsIn(SCENE_STATES) sceneState?: (typeof SCENE_STATES)[number];
  @IsIn(PROJECT_STATUSES) status!: (typeof PROJECT_STATUSES)[number];
  @IsInt() @Min(0) @Max(10_000) order!: number;
}

/** Status is intentionally excluded — only the workflow endpoint may transition it. */
export class UpdateProjectDto extends PartialType(OmitType(CreateProjectDto, ['status'] as const)) {}

export class ProjectWorkflowDto {
  @IsIn(WORKFLOW_TRANSITIONS) transition!: WorkflowTransition;
}

export class PublicListProjectsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsIn(['order', 'title', 'createdAt']) sort = 'order';
  @IsOptional() @IsIn(['asc', 'desc']) direction: 'asc' | 'desc' = 'asc';
}
export class ListProjectsDto extends PublicListProjectsDto {
  @IsOptional() @IsIn(PROJECT_STATUSES) status?: (typeof PROJECT_STATUSES)[number];
}

export const EVIDENCE_STATUSES = ['confirmed', 'pending', 'unavailable'] as const;
export type EvidenceStatusInput = (typeof EVIDENCE_STATUSES)[number];

export class CreateProjectMetricDto {
  @IsString() @MinLength(1) @MaxLength(120) label!: string;
  @IsString() @MinLength(1) @MaxLength(60) value!: string;
  @IsIn(EVIDENCE_STATUSES) evidence!: EvidenceStatusInput;
  @IsOptional() @IsString() @MaxLength(500) sourceNote?: string;
  @IsInt() @Min(0) @Max(10_000) order!: number;
}
export class UpdateProjectMetricDto extends PartialType(CreateProjectMetricDto) {}

export const FINDING_SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Informational'] as const;

export class CreateProjectFindingDto {
  @IsString() @MinLength(2) @MaxLength(160) title!: string;
  @IsString() @MinLength(10) @MaxLength(2000) summary!: string;
  @IsOptional() @IsIn(FINDING_SEVERITIES) severity?: (typeof FINDING_SEVERITIES)[number];
  @IsIn(EVIDENCE_STATUSES) evidenceStatus!: EvidenceStatusInput;
  @IsInt() @Min(0) @Max(10_000) order!: number;
}
export class UpdateProjectFindingDto extends PartialType(CreateProjectFindingDto) {}

export class ReorderDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) orderedIds!: string[];
}
