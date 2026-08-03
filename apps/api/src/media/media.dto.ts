import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const MEDIA_STATUSES = ['quarantined', 'approved', 'rejected', 'archived'] as const;
export const MEDIA_CATEGORIES = ['image', 'document'] as const;

export class ListMediaDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsIn(MEDIA_STATUSES) status?: (typeof MEDIA_STATUSES)[number];
  @IsOptional() @IsIn(MEDIA_CATEGORIES) category?: (typeof MEDIA_CATEGORIES)[number];
}

export class UpdateMediaDto {
  @IsOptional() @IsString() @MaxLength(400) altText?: string;
  @IsOptional() @IsBoolean() decorative?: boolean;
  @IsOptional() @IsString() @MaxLength(400) caption?: string;
  @IsOptional() @IsString() @MaxLength(500) sourceNote?: string;
}

export class ApproveMediaDto {
  @IsOptional() @IsString() @MaxLength(400) altText?: string;
  @IsOptional() @IsBoolean() decorative?: boolean;
}

export class RejectMediaDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}
