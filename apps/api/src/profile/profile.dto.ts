import { IsString } from 'class-validator';

export class SetPortraitDto {
  @IsString() mediaId!: string;
}
