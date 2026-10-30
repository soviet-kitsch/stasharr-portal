import { Equals, IsString, MaxLength } from 'class-validator';
import { RequestActionDto } from './request-action.dto';

export class DeleteWhisparrEntryDto extends RequestActionDto {
  @IsString() @MaxLength(32768) previewToken!: string;
  @Equals(true) confirmDeleteEntry!: boolean;
}
