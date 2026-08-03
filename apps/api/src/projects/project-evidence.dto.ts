import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { EVIDENCE_STATUSES, type EvidenceStatusInput } from './projects.dto';

export class CreateProjectEvidenceDto {
  @IsString() mediaId!: string;
  @IsOptional() @IsString() @MaxLength(160) title?: string;
  @IsOptional() @IsString() @MaxLength(400) caption?: string;
  @IsOptional() @IsString() @MaxLength(400) altText?: string;
  @IsOptional() @IsString() @MaxLength(500) sourceNote?: string;
  @IsIn(EVIDENCE_STATUSES) evidenceStatus!: EvidenceStatusInput;
  @IsInt() @Min(0) @Max(10_000) order!: number;
}

/** `mediaId` is intentionally excluded from the update shape — re-pointing an existing evidence
 * row at a different asset is not a supported edit; detach and re-attach instead, so the
 * approved-media check always runs against a freshly created row. */
export class UpdateProjectEvidenceDto extends PartialType(
  OmitType(CreateProjectEvidenceDto, ['mediaId'] as const),
) {}
