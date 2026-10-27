import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { SubmitSceneRequestDto } from './submit-scene-request.dto';

export class RequestActionDto {
  @IsUUID()
  operationKey!: string;
}

export class BatchRequestActionDto extends RequestActionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  ids!: string[];

  @IsIn(['RE_REQUEST', 'SEARCH', 'DISMISS', 'RESTORE'])
  kind!: 'RE_REQUEST' | 'SEARCH' | 'DISMISS' | 'RESTORE';

  @IsOptional()
  @ValidateNested()
  @Type(() => SubmitSceneRequestDto)
  settings?: SubmitSceneRequestDto;
}
