import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  IntegrationStatus,
  IntegrationType,
  Request,
  RequestStatus,
  Prisma,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { StashAdapter } from '../providers/stash/stash.adapter';
import {
  RequestOperationsService,
  BeforeDispatch,
  RequestActionKind,
} from './request-operations.service';
import { BatchRequestActionDto } from './dto/request-action.dto';
import { IndexingService } from '../indexing/indexing.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogProviderService } from '../providers/catalog/catalog-provider.service';
import { StashdbAdapter } from '../providers/stashdb/stashdb.adapter';
import { WhisparrAdapter } from '../providers/whisparr/whisparr.adapter';
import { RequestOptionsDto } from './dto/request-options.dto';
import { SubmitSceneRequestDto } from './dto/submit-scene-request.dto';
import { SubmitSceneRequestResponseDto } from './dto/submit-scene-request-response.dto';

@Injectable()
export class RequestsService {
  constructor(
    private readonly indexingService: IndexingService,
    private readonly integrationsService: IntegrationsService,
    private readonly catalogProviderService: CatalogProviderService,
    private readonly whisparrAdapter: WhisparrAdapter,
    private readonly stashdbAdapter: StashdbAdapter,
    private readonly prisma: PrismaService,
    private readonly operations: RequestOperationsService,
    private readonly stashAdapter: StashAdapter,
  ) {}

  async getRequestOptions(stashId: string): Promise<RequestOptionsDto> {
    const normalizedStashId = stashId.trim();
    if (!normalizedStashId) {
      throw new BadRequestException('Scene stashId is required.');
    }

    const whisparrConfig = await this.getWhisparrConfig();
    const catalogConfig = await this.getActiveCatalogConfig();

    const scene = await this.stashdbAdapter.getSceneById(
      normalizedStashId,
      catalogConfig,
    );

    const [rootFolders, qualityProfiles, tags] = await Promise.all([
      this.whisparrAdapter.getRootFolders(whisparrConfig),
      this.whisparrAdapter.getQualityProfiles(whisparrConfig),
      this.whisparrAdapter.getTags(whisparrConfig),
    ]);

    if (rootFolders.filter((folder) => folder.accessible).length === 0) {
      throw new ConflictException(
        'No accessible Whisparr root folders are available.',
      );
    }

    if (qualityProfiles.length === 0) {
      throw new ConflictException(
        'No Whisparr quality profiles are available.',
      );
    }

    const previous = await this.prisma.request.findUnique({
      where: { stashId: normalizedStashId },
    });
    const saved = previous?.settings as Partial<SubmitSceneRequestDto> | null;
    const savedRoot =
      saved?.rootFolderPath &&
      rootFolders.some(
        (folder) => folder.accessible && folder.path === saved.rootFolderPath,
      )
        ? saved.rootFolderPath
        : null;
    const savedProfile =
      saved?.qualityProfileId &&
      qualityProfiles.some((profile) => profile.id === saved.qualityProfileId)
        ? saved.qualityProfileId
        : null;
    const savedTags =
      saved?.tags?.filter((id) => tags.some((tag) => tag.id === id)) ?? [];
    return {
      ...(previous
        ? {
            settingsNotice: saved
              ? 'Review the saved settings. Missing folders, profiles or tags must be selected again.'
              : 'This older request has no saved settings. Choose a folder and quality profile before re-requesting.',
          }
        : {}),
      scene: {
        stashId: scene.id,
        title: scene.title,
        studio: scene.studioName,
      },
      defaults: {
        monitored: saved?.monitored ?? true,
        searchForMovie: saved?.searchForMovie ?? true,
        ...(previous
          ? {
              rootFolderPath: savedRoot,
              qualityProfileId: savedProfile,
              tags: savedTags,
            }
          : {}),
      },
      rootFolders,
      qualityProfiles,
      tags,
    };
  }

  async submitSceneRequest(
    stashId: string,
    dto: SubmitSceneRequestDto,
    kind: 'REQUEST' | 'RE_REQUEST' = 'REQUEST',
  ): Promise<SubmitSceneRequestResponseDto> {
    const id = this.normalizeId(stashId);
    const payload = {
      monitored: dto.monitored,
      rootFolderPath: dto.rootFolderPath,
      qualityProfileId: dto.qualityProfileId,
      tags: dto.tags,
      searchForMovie: dto.searchForMovie,
    };
    return this.operations.run(
      id,
      dto.operationKey ?? randomUUID(),
      kind,
      payload,
      (dispatch) => this.performSubmitSceneRequest(id, dto, dispatch),
    );
  }

  private async performSubmitSceneRequest(
    stashId: string,
    dto: SubmitSceneRequestDto,
    dispatch: BeforeDispatch,
  ): Promise<SubmitSceneRequestResponseDto> {
    const normalizedStashId = stashId.trim();
    if (!normalizedStashId) {
      throw new BadRequestException('Scene stashId is required.');
    }

    const whisparrConfig = await this.getWhisparrConfig();
    const catalogConfig = await this.getActiveCatalogConfig();

    const scene = await this.stashdbAdapter.getSceneById(
      normalizedStashId,
      catalogConfig,
    );
    if ((await this.getStashMatches(normalizedStashId)).length) {
      const request = await this.upsertLocalRequestRow(normalizedStashId);
      await this.indexingService.seedRequestedScene({
        stashId: normalizedStashId,
        requestStatus: request.status,
        requestUpdatedAt: request.updatedAt,
        requestRevision: request.revision,
        requestDismissedAt: null,
        title: scene.title,
        description: scene.details,
        imageUrl: scene.imageUrl,
        studioId: scene.studioId,
        studioName: scene.studioName,
        studioImageUrl: scene.studioImageUrl,
        releaseDate: scene.releaseDate,
        duration: scene.duration,
        stashAvailable: true,
      });
      return {
        accepted: true,
        alreadyExists: true,
        stashId: normalizedStashId,
        whisparrMovieId: null,
      };
    }
    const title = scene.title.trim();
    const studio = scene.studioName?.trim() ?? '';

    if (!title) {
      throw new ConflictException(
        'Scene metadata is missing a title required for Whisparr submission.',
      );
    }

    if (!studio) {
      throw new ConflictException(
        'Scene metadata is missing a studio required for Whisparr submission.',
      );
    }

    const existingMovie = await this.whisparrAdapter.findMovieByStashId(
      normalizedStashId,
      whisparrConfig,
    );
    if (existingMovie) {
      const request = await this.upsertLocalRequestRow(normalizedStashId);
      await this.indexingService.seedRequestedScene({
        stashId: normalizedStashId,
        requestStatus: request.status,
        requestUpdatedAt: request.updatedAt,
        requestRevision: request.revision,
        requestDismissedAt: null,
        title: scene.title,
        description: scene.details,
        imageUrl: scene.imageUrl,
        studioId: scene.studioId,
        studioName: scene.studioName,
        studioImageUrl: scene.studioImageUrl,
        releaseDate: scene.releaseDate,
        duration: scene.duration,
        whisparrMovieId: existingMovie.movieId,
        whisparrHasFile: existingMovie.hasFile,
      });
      void this.indexingService.requestImmediateRefresh(
        [normalizedStashId],
        'request-existing-movie',
      );
      return {
        accepted: true,
        alreadyExists: true,
        stashId: normalizedStashId,
        whisparrMovieId: existingMovie.movieId,
      };
    }

    const [rootFolders, qualityProfiles, tags] = await Promise.all([
      this.whisparrAdapter.getRootFolders(whisparrConfig),
      this.whisparrAdapter.getQualityProfiles(whisparrConfig),
      this.whisparrAdapter.getTags(whisparrConfig),
    ]);

    if (rootFolders.filter((folder) => folder.accessible).length === 0) {
      throw new ConflictException(
        'No accessible Whisparr root folders are available.',
      );
    }

    if (qualityProfiles.length === 0) {
      throw new ConflictException(
        'No Whisparr quality profiles are available.',
      );
    }

    const selectedRootFolder = rootFolders.find(
      (folder) => folder.path === dto.rootFolderPath,
    );
    if (!selectedRootFolder) {
      throw new BadRequestException(
        'Selected root folder does not exist in Whisparr.',
      );
    }
    if (!selectedRootFolder.accessible) {
      throw new BadRequestException(
        'Selected root folder is not accessible in Whisparr.',
      );
    }

    const selectedQualityProfile = qualityProfiles.find(
      (profile) => profile.id === dto.qualityProfileId,
    );
    if (!selectedQualityProfile) {
      throw new BadRequestException(
        'Selected quality profile does not exist in Whisparr.',
      );
    }

    const allowedTagIds = new Set(tags.map((tag) => tag.id));
    for (const tagId of dto.tags) {
      if (!allowedTagIds.has(tagId)) {
        throw new BadRequestException(
          `Selected tag id ${tagId} does not exist in Whisparr.`,
        );
      }
    }

    await dispatch({
      operation: 'CREATE_MOVIE',
      settings: {
        monitored: dto.monitored,
        rootFolderPath: dto.rootFolderPath,
        qualityProfileId: dto.qualityProfileId,
        searchForMovie: dto.searchForMovie,
        tags: dto.tags,
      },
    });
    const createdMovie = await this.whisparrAdapter.createMovie(
      {
        title,
        studio,
        foreignId: normalizedStashId,
        monitored: dto.monitored,
        rootFolderPath: dto.rootFolderPath,
        addOptions: {
          searchForMovie: dto.searchForMovie,
        },
        qualityProfileId: dto.qualityProfileId,
        tags: dto.tags,
      },
      whisparrConfig,
    );

    const request = await this.upsertLocalRequestRow(normalizedStashId, dto);
    await this.indexingService.seedRequestedScene({
      stashId: normalizedStashId,
      requestStatus: request.status,
      requestUpdatedAt: request.updatedAt,
      requestRevision: request.revision,
      requestDismissedAt: null,
      title: scene.title,
      description: scene.details,
      imageUrl: scene.imageUrl,
      studioId: scene.studioId,
      studioName: scene.studioName,
      studioImageUrl: scene.studioImageUrl,
      releaseDate: scene.releaseDate,
      duration: scene.duration,
      whisparrMovieId: createdMovie.movieId ?? undefined,
      whisparrHasFile: false,
    });
    void this.indexingService.requestImmediateRefresh(
      [normalizedStashId],
      'request-submitted',
    );

    return {
      accepted: true,
      alreadyExists: false,
      stashId: normalizedStashId,
      whisparrMovieId: createdMovie.movieId ?? null,
    };
  }

  private async upsertLocalRequestRow(
    stashId: string,
    settings?: SubmitSceneRequestDto,
  ): Promise<Request> {
    const savedSettings = settings
      ? {
          monitored: settings.monitored,
          rootFolderPath: settings.rootFolderPath,
          qualityProfileId: settings.qualityProfileId,
          searchForMovie: settings.searchForMovie,
          tags: settings.tags,
        }
      : undefined;
    return this.prisma.request.upsert({
      where: { stashId },
      create: {
        stashId,
        status: RequestStatus.REQUESTED,
        settings: savedSettings,
      },
      update: {
        dismissedAt: null,
        revision: { increment: 1 },
        ...(savedSettings ? { settings: savedSettings } : {}),
      },
    });
  }

  private normalizeId(value: string): string {
    const id = value.trim();
    if (!id || id.length > 120)
      throw new BadRequestException('A valid scene ID is required.');
    return id;
  }

  private async getStashMatches(id: string) {
    await this.getActiveCatalogConfig();
    const stash = await this.getIntegration(IntegrationType.STASH);
    if (
      !stash.enabled ||
      stash.status !== IntegrationStatus.CONFIGURED ||
      !stash.baseUrl
    ) {
      throw new ConflictException(
        'Stash must be available to check for an existing copy before acquisition.',
      );
    }
    return this.stashAdapter.findScenesByStashId(
      id,
      { baseUrl: stash.baseUrl, apiKey: stash.apiKey },
      { providerKey: 'STASHDB' },
    );
  }

  async setDismissed(stashId: string, key: string, dismissed: boolean) {
    const id = this.normalizeId(stashId);
    return this.operations.run(
      id,
      key,
      dismissed ? 'DISMISS' : 'RESTORE',
      { dismissed },
      async () => {
        await this.prisma.request.update({
          where: { stashId: id },
          data: {
            dismissedAt: dismissed ? new Date() : null,
            revision: { increment: 1 },
          },
        });
        let projectionPending = false;
        try {
          await this.indexingService.refreshRequestRow(id);
        } catch {
          projectionPending = true;
        }
        return {
          outcome: dismissed ? 'DISMISSED' : 'RESTORED',
          projectionPending,
        };
      },
    );
  }

  async searchAgain(stashId: string, key: string) {
    const id = this.normalizeId(stashId);
    return this.operations.run(id, key, 'SEARCH', {}, async (dispatch) => {
      if ((await this.getStashMatches(id)).length)
        return { outcome: 'ALREADY_AVAILABLE' };
      const config = await this.getWhisparrConfig();
      const movie = await this.whisparrAdapter.findMovieByStashId(id, config);
      if (!movie)
        throw new ConflictException(
          'The entry is missing in Whisparr. Use Re-request and review its settings.',
        );
      if (movie.hasFile)
        throw new ConflictException(
          'Whisparr already has the file. Review its Stash match before searching again.',
        );
      const [queue, commands] = await Promise.all([
        this.whisparrAdapter.getQueueSnapshot(config),
        this.whisparrAdapter.getSearchCommands(config),
      ]);
      if (queue.some((item) => item.movieId === movie.movieId))
        return { outcome: 'ALREADY_QUEUED' };
      if (
        commands.some(
          (command) =>
            command.movieIds.includes(movie.movieId) &&
            (['queued', 'started'].includes(command.status.toLowerCase()) ||
              (command.queuedAt &&
                Date.now() - new Date(command.queuedAt).getTime() < 60_000)),
        )
      )
        return { outcome: 'ALREADY_SEARCHING' };
      const fresh = await this.whisparrAdapter.findMovieByStashId(id, config);
      if (!fresh || fresh.movieId !== movie.movieId || fresh.hasFile)
        throw new ConflictException(
          'The entry changed during the check. Refresh status before continuing.',
        );
      await dispatch({ movieId: movie.movieId });
      const result = await this.whisparrAdapter.searchMovie(
        movie.movieId,
        config,
      );
      return { outcome: 'SEARCH_STARTED', commandId: result.commandId };
    });
  }

  async getHistory(stashId: string) {
    const id = this.normalizeId(stashId);
    const request = await this.prisma.request.findUnique({
      where: { stashId: id },
    });
    const actions = await this.prisma.requestAction.findMany({
      where: { stashId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        kind: true,
        state: true,
        createdAt: true,
        updatedAt: true,
        result: true,
      },
    });
    return {
      dismissed: Boolean(request?.dismissedAt),
      activeActionId: request?.activeActionId ?? null,
      settingsSaved: Boolean(request?.settings),
      actions,
    };
  }

  async checkOutcome(stashId: string) {
    const id = this.normalizeId(stashId);
    const request = await this.prisma.request.findUnique({
      where: { stashId: id },
    });
    if (!request?.activeActionId) return { outcome: 'NO_PENDING_ACTION' };
    const action = await this.prisma.requestAction.findUnique({
      where: { id: request.activeActionId },
    });
    if (!action)
      throw new ConflictException(
        'The pending action record is missing. Review the request history.',
      );
    if (
      action.state === 'RUNNING' &&
      Date.now() - action.updatedAt.getTime() < 2 * 60_000
    )
      throw new ConflictException(
        'The action may still be running. Wait briefly before checking again.',
      );
    if (!action.dispatchedAt) {
      await this.operations.recoverUnsent(id, action.id);
      return {
        outcome: 'NOT_SENT',
        message:
          'The interrupted action was not sent. A new attempt is now allowed.',
      };
    }
    const config = await this.getWhisparrConfig();
    if (action.kind === 'REQUEST' || action.kind === 'RE_REQUEST') {
      await this.getActiveCatalogConfig();
      const movie = await this.whisparrAdapter.findMovieByStashId(id, config);
      if (movie || (await this.getStashMatches(id)).length) {
        const details = action.details as {
          settings?: Prisma.InputJsonObject;
        } | null;
        await this.prisma.request.update({
          where: { stashId: id },
          data: {
            dismissedAt: null,
            revision: { increment: 1 },
            ...(details?.settings ? { settings: details.settings } : {}),
          },
        });
        await this.indexingService.refreshRequestRow(id);
        const result = {
          accepted: true,
          alreadyExists: true,
          stashId: id,
          whisparrMovieId: movie?.movieId ?? null,
        };
        await this.operations.finish(id, action.id, 'SUCCEEDED', result);
        // Recovery records a confirmed outcome, but does not submit another request.
        try {
          await this.indexingService.requestImmediateRefresh(
            [id],
            'outcome-check',
          );
        } catch {
          /* Polling can reconcile later. */
        }
        return { outcome: 'REQUEST_CONFIRMED' };
      }
    } else if (action.kind === 'SEARCH') {
      const details = action.details as { movieId?: number } | null;
      const commands = await this.whisparrAdapter.getSearchCommands(config);
      const match = commands.find(
        (command) =>
          command.movieIds.includes(details?.movieId ?? -1) &&
          command.queuedAt &&
          new Date(command.queuedAt).getTime() >=
            action.dispatchedAt!.getTime() - 5000,
      );
      if (match) {
        const result = { outcome: 'SEARCH_CONFIRMED', commandId: match.id };
        await this.operations.finish(id, action.id, 'SUCCEEDED', result);
        return result;
      }
    }
    throw new ConflictException(
      'The outcome is still unknown. Nothing has been sent again. Inspect Whisparr before attempting a manual recovery.',
    );
  }

  async previewBatch(dto: BatchRequestActionDto) {
    const results: Array<{ id: string; eligible: boolean; message: string }> =
      [];
    for (const raw of dto.ids) {
      const id = this.normalizeId(raw);
      try {
        const request = await this.prisma.request.findUnique({
          where: { stashId: id },
        });
        if (request?.activeActionId)
          throw new ConflictException(
            'An action is running or awaiting an outcome check.',
          );
        if (dto.kind === 'DISMISS' || dto.kind === 'RESTORE') {
          results.push({
            id,
            eligible: true,
            message:
              dto.kind === 'DISMISS'
                ? 'Remove from Portal only. Whisparr, downloads and files remain unchanged.'
                : 'Restore to Portal tracking.',
          });
          continue;
        }
        if ((await this.getStashMatches(id)).length)
          throw new ConflictException('Already available in Stash.');
        const movie = await this.whisparrAdapter.findMovieByStashId(
          id,
          await this.getWhisparrConfig(),
        );
        if (dto.kind === 'RE_REQUEST' && movie)
          throw new ConflictException(
            movie.hasFile
              ? 'Already imported. Review its Stash match.'
              : 'Already in Whisparr. Use Search again.',
          );
        if (dto.kind === 'SEARCH' && (!movie || movie.hasFile))
          throw new ConflictException(
            movie
              ? 'Already imported. Review its Stash match.'
              : 'Missing in Whisparr. Use Re-request.',
          );
        results.push({
          id,
          eligible: true,
          message:
            dto.kind === 'SEARCH'
              ? 'Run one search; existing monitoring settings are preserved.'
              : 'Create only if still absent, using the settings you review.',
        });
      } catch (error) {
        results.push({
          id,
          eligible: false,
          message:
            error instanceof ConflictException
              ? error.message
              : 'Could not verify this scene. No action will be taken.',
        });
      }
    }
    return { results };
  }

  async executeBatch(dto: BatchRequestActionDto) {
    const results: Array<{
      id: string;
      ok: boolean;
      result?: object;
      message?: string;
    }> = [];
    for (const raw of dto.ids) {
      const id = this.normalizeId(raw);
      const key = createHash('sha256')
        .update(dto.operationKey + ':' + id)
        .digest('hex');
      try {
        let result: object;
        if (dto.kind === 'DISMISS' || dto.kind === 'RESTORE')
          result = await this.setDismissed(id, key, dto.kind === 'DISMISS');
        else if (dto.kind === 'SEARCH')
          result = await this.searchAgain(id, key);
        else {
          if (!dto.settings)
            throw new BadRequestException(
              'Review the folder and quality settings before re-requesting.',
            );
          result = await this.submitSceneRequest(
            id,
            { ...dto.settings, operationKey: key },
            'RE_REQUEST',
          );
        }
        results.push({ id, ok: true, result });
      } catch (error) {
        results.push({
          id,
          ok: false,
          message:
            error instanceof ConflictException ||
            error instanceof BadRequestException
              ? error.message
              : 'Action failed before a confirmed result. Check its history before retrying.',
        });
      }
    }
    return { results };
  }

  private async getWhisparrConfig(): Promise<{
    baseUrl: string;
    apiKey: string | null;
  }> {
    const integration = await this.getIntegration(IntegrationType.WHISPARR);

    if (!integration.enabled) {
      throw new ConflictException('WHISPARR integration is disabled.');
    }

    if (integration.status !== IntegrationStatus.CONFIGURED) {
      throw new ConflictException('WHISPARR integration is not configured.');
    }

    const baseUrl = integration.baseUrl?.trim();
    if (!baseUrl) {
      throw new BadRequestException(
        'WHISPARR integration is missing a base URL.',
      );
    }

    return {
      baseUrl,
      apiKey: integration.apiKey,
    };
  }

  private async getActiveCatalogConfig(): Promise<{
    baseUrl: string;
    apiKey: string | null;
  }> {
    const catalogProvider =
      await this.catalogProviderService.getConfiguredCatalogProvider();
    if (catalogProvider.providerKey !== 'STASHDB')
      throw new ConflictException(
        'This catalog is not supported for Whisparr acquisition. Use the independent acquisition route.',
      );

    return {
      baseUrl: catalogProvider.baseUrl,
      apiKey: catalogProvider.apiKey,
    };
  }

  private async getIntegration(type: IntegrationType) {
    try {
      return await this.integrationsService.findOne(type);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new ConflictException(
          `${type} integration has not been created yet.`,
        );
      }

      throw error;
    }
  }
}
