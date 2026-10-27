import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class SubmitSceneRequestDto {
  @IsOptional()
  @IsUUID()
  operationKey?: string;
  @Transform(({ value }) => value !== false)
  @IsBoolean()
  monitored = true;

  @IsString()
  @IsNotEmpty()
  rootFolderPath!: string;

  @Transform(({ value }) => value !== false)
  @IsBoolean()
  searchForMovie = true;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  qualityProfileId!: number;

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  tags: number[] = [];
}
