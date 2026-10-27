import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateIntegrationDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsUrl({
    require_tld: false,
    require_protocol: true,
  })
  baseUrl?: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  browserUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  defaultRootFolderPath?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  defaultQualityProfileId?: number | null;
}
