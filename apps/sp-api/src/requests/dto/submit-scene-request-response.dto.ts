export class SubmitSceneRequestResponseDto {
  outcome?: string;
  message?: string;
  commandId?: number;
  accepted!: boolean;
  alreadyExists!: boolean;
  stashId!: string;
  whisparrMovieId!: number | null;
}
