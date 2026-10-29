import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { DiscoverQueryDto } from '../discover/dto/discover-query.dto';
import type { AcquisitionLifecycleFilter } from '../acquisition/dto/acquisition-scenes-query.dto';

export class DiagnosticTableQuery extends DiscoverQueryDto {
  @IsOptional()
  @IsIn(['ANY', 'REQUESTED', 'DOWNLOADING', 'IMPORT_PENDING', 'FAILED'])
  lifecycle?: AcquisitionLifecycleFilter;
  @IsOptional() @IsString() @MaxLength(160) q?: string;
  @IsOptional()
  @IsIn([
    'NEEDS_ATTENTION',
    'UNKNOWN',
    'SEARCHING',
    'NO_CANDIDATES',
    'ALL_REJECTED',
    'CANDIDATES',
    'INCOMPLETE',
    'STATUS_UNAVAILABLE',
    'ORPHANED_REQUEST',
    'WAITING_FOR_STASH_MATCH',
    'WHISPARR_BLOCKED',
  ])
  blocker?: string;
  @IsOptional() @IsIn(['ATTENTION', 'OLDEST', 'ACTIVITY']) sort?: string;
}
export class DiagnosticSearchDto {
  @IsUUID('4') operationKey!: string;
}
export class HydraSettingsDto {
  @IsString() @MaxLength(1000) browserUrl!: string;
  @IsBoolean() studio!: boolean;
  @IsBoolean() performers!: boolean;
  @IsBoolean() title!: boolean;
}
