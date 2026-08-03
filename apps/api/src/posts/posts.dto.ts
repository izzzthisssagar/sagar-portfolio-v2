import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { containsDisallowedMarkup } from './markdown-safety';

export const POST_STATUSES = ['draft', 'review', 'published', 'archived'] as const;
export const WORKFLOW_TRANSITIONS = ['draft', 'review', 'publish', 'archive'] as const;
export type WorkflowTransition = (typeof WORKFLOW_TRANSITIONS)[number];

@ValidatorConstraint({ name: 'noRawHtml', async: false })
class NoRawHtmlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && !containsDisallowedMarkup(value);
  }
  defaultMessage(): string {
    return 'Body must be plain Markdown — raw HTML tags are not allowed.';
  }
}

export class CreatePostDto {
  @IsString() @MinLength(2) @MaxLength(160) title!: string;
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) slug!: string;
  @IsOptional() @IsString() @MaxLength(400) excerpt?: string;
  @IsOptional() @IsString() @MaxLength(50_000) @Validate(NoRawHtmlConstraint) body?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsString() featuredImageId?: string;
  @IsOptional() @IsString() @MaxLength(160) seoTitle?: string;
  @IsOptional() @IsString() @MaxLength(300) seoDescription?: string;
  @IsOptional() @IsUrl({ protocols: ['https', 'http'] }) @MaxLength(500) canonicalUrl?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) displayOrder?: number;
}

/** `status` is intentionally absent — every post is created DRAFT and can only move through
 * review/publish/archive via `POST /admin/posts/:id/workflow`, which runs publish validation. */
export class UpdatePostDto extends PartialType(CreatePostDto) {}

export class PostWorkflowDto {
  @IsIn(WORKFLOW_TRANSITIONS) transition!: WorkflowTransition;
}

export class PublicListPostsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @IsString() @MaxLength(120) tag?: string;
}

export class ListPostsDto extends PublicListPostsDto {
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsIn(POST_STATUSES) status?: (typeof POST_STATUSES)[number];
}
