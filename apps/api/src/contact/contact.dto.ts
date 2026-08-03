import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const CONTACT_STATUSES = ['new', 'read', 'replied', 'archived', 'spam'] as const;
export type ContactStatusInput = (typeof CONTACT_STATUSES)[number];

export class SubmitContactDto {
  @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsEmail() @MaxLength(320) email!: string;
  @IsOptional() @IsString() @MaxLength(200) subject?: string;
  @IsOptional() @IsString() @MaxLength(160) company?: string;
  @IsString() @MinLength(1) @MaxLength(5000) message!: string;
  /** Honeypot — a real visitor never fills this in (it's hidden via CSS, not `type="hidden"`,
   * so form-filling bots that skip hidden inputs still trip it). Never persisted. */
  @IsOptional() @IsString() @MaxLength(200) website?: string;
}

export class ListContactMessagesDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @IsString() @MaxLength(160) search?: string;
  @IsOptional() @IsIn(CONTACT_STATUSES) status?: ContactStatusInput;
}

export class UpdateContactStatusDto {
  @IsIn(CONTACT_STATUSES) status!: ContactStatusInput;
}
