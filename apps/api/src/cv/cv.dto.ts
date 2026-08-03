import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCvDocumentDto {
  @IsString() mediaId!: string;
  @IsString() @MinLength(1) @MaxLength(160) title!: string;
  @IsOptional() @IsString() @MaxLength(500) versionNote?: string;
}
