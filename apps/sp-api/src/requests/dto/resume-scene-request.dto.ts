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

// Creation settings are optional when resuming an existing acquisition. The
// service requires and revalidates them if a new Whisparr entry is needed.
export class ResumeSceneRequestDto {
  @IsOptional() @IsUUID() operationKey?: string;
  @Transform(({ value }) => value !== false) @IsBoolean() monitored = true;
  @IsOptional() @IsString() @IsNotEmpty() rootFolderPath?: string;
  @Transform(({ value }) => value !== false) @IsBoolean() searchForMovie = true;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) qualityProfileId?: number;
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  tags: number[] = [];
}
