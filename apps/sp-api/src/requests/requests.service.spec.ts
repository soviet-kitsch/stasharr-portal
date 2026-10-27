import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  IntegrationStatus,
  IntegrationType,
  RequestStatus,
} from '@prisma/client';
import { IndexingService } from '../indexing/indexing.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogProviderService } from '../providers/catalog/catalog-provider.service';
import { StashdbAdapter } from '../providers/stashdb/stashdb.adapter';
import { WhisparrAdapter } from '../providers/whisparr/whisparr.adapter';
import { RequestsService } from './requests.service';
import { RequestOperationsService } from './request-operations.service';
import { StashAdapter } from '../providers/stash/stash.adapter';

describe('RequestsService', () => {
  const findOneMock = jest.fn();
  const getConfiguredCatalogProviderMock = jest.fn();
  const findMovieByStashIdMock = jest.fn();
  const getRootFoldersMock = jest.fn();
  const getQualityProfilesMock = jest.fn();
  const getTagsMock = jest.fn();
  const createMovieMock = jest.fn();
  const getSceneByIdMock = jest.fn();
  const upsertRequestMock = jest.fn();
  const seedRequestedSceneMock = jest.fn();
  const requestImmediateRefreshMock = jest.fn();

  const indexingService = {
    seedRequestedScene: seedRequestedSceneMock,
    requestImmediateRefresh: requestImmediateRefreshMock,
  } as unknown as IndexingService;

  const integrationsService = {
    findOne: findOneMock,
  } as unknown as IntegrationsService;
  const catalogProviderService = {
    getConfiguredCatalogProvider: getConfiguredCatalogProviderMock,
  } as unknown as CatalogProviderService;

  const whisparrAdapter = {
    findMovieByStashId: findMovieByStashIdMock,
    getRootFolders: getRootFoldersMock,
    getQualityProfiles: getQualityProfilesMock,
    getTags: getTagsMock,
    createMovie: createMovieMock,
  } as unknown as WhisparrAdapter;

  const stashdbAdapter = {
    getSceneById: getSceneByIdMock,
  } as unknown as StashdbAdapter;

  const prismaService = {
    request: {
      upsert: upsertRequestMock,
      findUnique: jest.fn().mockResolvedValue(null),
    },
  } as unknown as PrismaService;

  const configuredWhisparrIntegration = {
    enabled: true,
    status: IntegrationStatus.CONFIGURED,
    baseUrl: 'http://whisparr.local',
    apiKey: 'wh-key',
  };

  const configuredStashdbIntegration = {
    integrationType: 'STASHDB',
    providerKey: 'STASHDB',
    label: 'StashDB',
    baseUrl: 'http://stashdb.local',
    apiKey: 'stashdb-key',
  };

  let service: RequestsService;

  beforeEach(() => {
    jest.clearAllMocks();
    findMovieByStashIdMock.mockResolvedValue(null);

    service = new RequestsService(
      indexingService,
      integrationsService,
      catalogProviderService,
      whisparrAdapter,
      stashdbAdapter,
      prismaService,
      {
        run: (
          _id: string,
          _key: string,
          _kind: string,
          _payload: object,
          work: (dispatch: () => Promise<void>) => Promise<object>,
        ) => work(async () => {}),
      } as unknown as RequestOperationsService,
      {
        findScenesByStashId: jest.fn().mockResolvedValue([]),
      } as unknown as StashAdapter,
    );

    findOneMock.mockImplementation((type: IntegrationType) => {
      if (type === IntegrationType.WHISPARR) {
        return configuredWhisparrIntegration;
      }
      if (type === IntegrationType.STASH)
        return {
          ...configuredWhisparrIntegration,
          baseUrl: 'http://stash.local',
        };

      throw new Error('Unexpected integration type');
    });
    getConfiguredCatalogProviderMock.mockResolvedValue(
      configuredStashdbIntegration,
    );

    getSceneByIdMock.mockImplementation((stashId: string) =>
      Promise.resolve({
        id: stashId,
        title: `Title ${stashId}`,
        details: `Description ${stashId}`,
        imageUrl: `http://image/${stashId}`,
        images: [],
        studioId: 'studio-1',
        studioName: 'Studio',
        studioImageUrl: 'http://studio/image',
        releaseDate: '2026-01-01',
        duration: 123,
        tags: [],
        performers: [],
        sourceUrls: [],
      }),
    );
    upsertRequestMock.mockImplementation(
      ({ where }: { where: { stashId: string } }) =>
        Promise.resolve({
          stashId: where.stashId,
          status: RequestStatus.REQUESTED,
          updatedAt: new Date('2026-03-27T00:00:00.000Z'),
        }),
    );
    requestImmediateRefreshMock.mockResolvedValue(undefined);
  });

  it('returns normalized request options with defaults', async () => {
    getRootFoldersMock.mockResolvedValue([
      { id: 1, path: '/media/a', accessible: false },
      { id: 2, path: '/media/b', accessible: true },
    ]);
    getQualityProfilesMock.mockResolvedValue([{ id: 10, name: 'Default' }]);
    getTagsMock.mockResolvedValue([{ id: 50, label: 'VR' }]);

    const result = await service.getRequestOptions('scene-1');

    expect(result).toEqual({
      scene: {
        stashId: 'scene-1',
        title: 'Title scene-1',
        studio: 'Studio',
      },
      requiresSettings: true,
      defaultSources: {
        rootFolderPath: 'ONLY_OPTION',
        qualityProfileId: 'ONLY_OPTION',
      },
      defaults: {
        monitored: true,
        searchForMovie: true,
        rootFolderPath: '/media/b',
        qualityProfileId: 10,
        tags: [],
      },
      rootFolders: [
        { id: 1, path: '/media/a', accessible: false },
        { id: 2, path: '/media/b', accessible: true },
      ],
      qualityProfiles: [{ id: 10, name: 'Default' }],
      tags: [{ id: 50, label: 'VR' }],
    });
  });

  it('throws when there are no accessible root folders', async () => {
    getRootFoldersMock.mockResolvedValue([
      { id: 1, path: '/media/a', accessible: false },
    ]);
    getQualityProfilesMock.mockResolvedValue([{ id: 10, name: 'Default' }]);
    getTagsMock.mockResolvedValue([]);

    await expect(service.getRequestOptions('scene-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('submits create movie request and upserts local request row', async () => {
    findMovieByStashIdMock.mockResolvedValue(null);
    getRootFoldersMock.mockResolvedValue([
      { id: 2, path: '/media/b', accessible: true },
    ]);
    getQualityProfilesMock.mockResolvedValue([{ id: 10, name: 'Default' }]);
    getTagsMock.mockResolvedValue([{ id: 50, label: 'VR' }]);
    createMovieMock.mockResolvedValue({ movieId: 444 });

    const result = await service.submitSceneRequest('scene-1', {
      monitored: true,
      rootFolderPath: '/media/b',
      searchForMovie: true,
      qualityProfileId: 10,
      tags: [50],
    });

    expect(createMovieMock).toHaveBeenCalledWith(
      {
        title: 'Title scene-1',
        studio: 'Studio',
        foreignId: 'scene-1',
        monitored: true,
        rootFolderPath: '/media/b',
        addOptions: { searchForMovie: true },
        qualityProfileId: 10,
        tags: [50],
      },
      expect.objectContaining({ baseUrl: 'http://whisparr.local' }),
    );
    expect(upsertRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stashId: 'scene-1' },
        create: expect.objectContaining({
          stashId: 'scene-1',
          status: RequestStatus.REQUESTED,
          settings: expect.objectContaining({
            rootFolderPath: '/media/b',
            qualityProfileId: 10,
            tags: [50],
          }),
        }),
        update: expect.objectContaining({
          dismissedAt: null,
          revision: { increment: 1 },
        }),
      }),
    );
    expect(seedRequestedSceneMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stashId: 'scene-1',
        whisparrMovieId: 444,
        whisparrHasFile: false,
        requestStatus: RequestStatus.REQUESTED,
      }),
    );
    expect(requestImmediateRefreshMock).toHaveBeenCalledWith(
      ['scene-1'],
      'request-submitted',
    );
    expect(result).toMatchObject({
      outcome: 'REQUEST_CREATED',
      accepted: true,
      alreadyExists: false,
      stashId: 'scene-1',
      whisparrMovieId: 444,
    });
  });

  it('treats existing whisparr movie as idempotent success', async () => {
    findMovieByStashIdMock.mockResolvedValue({
      movieId: 999,
      stashId: 'scene-1',
      hasFile: false,
    });

    const result = await service.submitSceneRequest('scene-1', {
      monitored: true,
      rootFolderPath: '/media/b',
      searchForMovie: true,
      qualityProfileId: 10,
      tags: [],
    });

    expect(createMovieMock).not.toHaveBeenCalled();
    expect(upsertRequestMock).toHaveBeenCalledTimes(1);
    expect(seedRequestedSceneMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stashId: 'scene-1',
        whisparrMovieId: 999,
        whisparrHasFile: false,
      }),
    );
    expect(requestImmediateRefreshMock).toHaveBeenCalledWith(
      ['scene-1'],
      'request-resumed',
    );
    expect(result).toMatchObject({
      outcome: 'ENTRY_REUSED',
      accepted: true,
      alreadyExists: true,
      stashId: 'scene-1',
      whisparrMovieId: 999,
    });
  });

  it('throws for missing scene metadata required for provider payload', async () => {
    getSceneByIdMock.mockResolvedValue({
      id: 'scene-1',
      title: 'Title scene-1',
      details: null,
      imageUrl: null,
      images: [],
      studioId: null,
      studioName: null,
      studioImageUrl: null,
      releaseDate: null,
      duration: null,
      tags: [],
      performers: [],
      sourceUrls: [],
    });

    await expect(
      service.submitSceneRequest('scene-1', {
        monitored: true,
        rootFolderPath: '/media/b',
        searchForMovie: true,
        qualityProfileId: 10,
        tags: [],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws when no quality profiles are available during submit', async () => {
    findMovieByStashIdMock.mockResolvedValue(null);
    getRootFoldersMock.mockResolvedValue([
      { id: 2, path: '/media/b', accessible: true },
    ]);
    getQualityProfilesMock.mockResolvedValue([]);
    getTagsMock.mockResolvedValue([]);

    await expect(
      service.submitSceneRequest('scene-1', {
        monitored: true,
        rootFolderPath: '/media/b',
        searchForMovie: true,
        qualityProfileId: 10,
        tags: [],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws when STASHDB integration has no baseUrl', async () => {
    getConfiguredCatalogProviderMock.mockRejectedValue(
      new BadRequestException('StashDB integration is missing a base URL.'),
    );

    await expect(service.getRequestOptions('scene-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('does not route independent catalog IDs into Whisparr acquisition', async () => {
    getRootFoldersMock.mockResolvedValue([
      { id: 2, path: '/media/b', accessible: true },
    ]);
    getQualityProfilesMock.mockResolvedValue([{ id: 10, name: 'Default' }]);
    getTagsMock.mockResolvedValue([]);
    getConfiguredCatalogProviderMock.mockResolvedValue({
      integrationType: 'FANSDB',
      providerKey: 'FANSDB',
      label: 'FansDB',
      baseUrl: 'http://fansdb.local/graphql',
      apiKey: 'fansdb-key',
    });

    await expect(service.getRequestOptions('scene-1')).rejects.toThrow(
      'independent acquisition route',
    );
    expect(createMovieMock).not.toHaveBeenCalled();
  });
});
