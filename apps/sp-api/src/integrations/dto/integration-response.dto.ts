export class IntegrationResponseDto {
  type!: 'STASHDB' | 'FANSDB' | 'STASH' | 'WHISPARR';
  enabled!: boolean;
  status!: 'NOT_CONFIGURED' | 'CONFIGURED' | 'ERROR';
  name!: string | null;
  baseUrl!: string | null;
  browserUrl!: string | null;
  defaultRootFolderPath!: string | null;
  defaultQualityProfileId!: number | null;
  hasApiKey!: boolean;
  lastHealthyAt!: string | null;
  lastErrorAt!: string | null;
  lastErrorMessage!: string | null;
}
