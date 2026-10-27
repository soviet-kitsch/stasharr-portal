export class RequestOptionsSceneDto {
  stashId!: string;
  title!: string;
  studio!: string | null;
}

export type RequestDefaultSource =
  | 'SAVED'
  | 'CONFIGURED'
  | 'ONLY_OPTION'
  | 'REQUIRED';

export class RequestOptionsDefaultsDto {
  monitored!: boolean;
  searchForMovie!: boolean;
  rootFolderPath?: string | null;
  qualityProfileId?: number | null;
  tags?: number[];
}

export class RequestOptionsRootFolderDto {
  id!: number;
  path!: string;
  accessible!: boolean;
}

export class RequestOptionsQualityProfileDto {
  id!: number;
  name!: string;
}

export class RequestOptionsTagDto {
  id!: number;
  label!: string;
}

export class RequestOptionsDto {
  settingsNotice?: string;
  requiresSettings?: boolean;
  plannedAction?: string;
  plannedMessage?: string;
  defaultSources?: {
    rootFolderPath: RequestDefaultSource;
    qualityProfileId: RequestDefaultSource;
  };
  scene!: RequestOptionsSceneDto;
  defaults!: RequestOptionsDefaultsDto;
  rootFolders!: RequestOptionsRootFolderDto[];
  qualityProfiles!: RequestOptionsQualityProfileDto[];
  tags!: RequestOptionsTagDto[];
}
