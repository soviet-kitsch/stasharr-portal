import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogProviderService } from '../providers/catalog/catalog-provider.service';
import { StashdbAdapter } from '../providers/stashdb/stashdb.adapter';
import { StudiosService } from './studios.service';

describe('StudiosService', () => {
  const catalogProviderService = {
    getConfiguredCatalogProvider: jest.fn(),
  } as unknown as CatalogProviderService;

  const stashdbAdapter = {
    getStudiosFeed: jest.fn(),
    getStudioById: jest.fn(),
  } as unknown as StashdbAdapter;
  const studioNetworkFavorite = {
    findUnique: jest.fn(),
    createMany: jest.fn(),
    deleteMany: jest.fn(),
  };

  const stashdbIntegration = {
    integrationType: 'STASHDB',
    providerKey: 'STASHDB',
    label: 'StashDB',
    baseUrl: 'http://stashdb.local/graphql',
    apiKey: 'stashdb-key',
  };

  let service: StudiosService;

  beforeEach(() => {
    jest.clearAllMocks();
    studioNetworkFavorite.findUnique.mockResolvedValue(null);
    service = new StudiosService(
      catalogProviderService,
      stashdbAdapter,
      { studioNetworkFavorite } as unknown as PrismaService,
    );

    catalogProviderService.getConfiguredCatalogProvider = jest
      .fn()
      .mockResolvedValue(stashdbIntegration);

    stashdbAdapter.getStudiosFeed = jest.fn().mockResolvedValue({
      total: 1,
      studios: [
        {
          id: 'studio-1',
          name: 'Studio One',
          isFavorite: true,
          imageUrl: 'http://studio-image',
          parentStudio: null,
          childStudios: [{ id: 'child-1', name: 'Studio Child' }],
        },
      ],
    });
    stashdbAdapter.getStudioById = jest.fn().mockResolvedValue({
      id: 'studio-1',
      name: 'Studio One',
      aliases: ['Alias One'],
      deleted: false,
      isFavorite: true,
      createdAt: '2024-01-01',
      updatedAt: '2024-02-01',
      imageUrl: 'http://studio-image',
      images: [
        {
          id: 'img-1',
          url: 'http://studio-image',
          width: 400,
          height: 220,
        },
      ],
      urls: [
        {
          url: 'https://stashdb.org/studios/studio-1',
          type: 'DETAILS',
          siteName: 'StashDB',
          siteUrl: 'https://stashdb.org',
          siteIcon: null,
        },
      ],
      parentStudio: {
        id: 'parent-1',
        name: 'Parent Studio',
        aliases: ['Parent Alias'],
        isFavorite: false,
        urls: [],
      },
      childStudios: [
        {
          id: 'child-1',
          name: 'Child Studio',
          aliases: [],
          deleted: false,
          isFavorite: false,
          createdAt: null,
          updatedAt: null,
          imageUrl: null,
        },
      ],
    });
  });

  it('uses default query behavior for studios feed', async () => {
    await expect(service.getStudiosFeed()).resolves.toEqual({
      total: 1,
      page: 1,
      perPage: 24,
      hasMore: false,
      items: [
        {
          id: 'studio-1',
          name: 'Studio One',
          isFavorite: true,
          imageUrl: 'http://studio-image',
          parentStudio: null,
          childStudios: [{ id: 'child-1', name: 'Studio Child' }],
        },
      ],
    });

    expect(stashdbAdapter.getStudiosFeed).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 1,
      perPage: 24,
      name: undefined,
      sort: 'NAME',
      direction: 'ASC',
      favoritesOnly: false,
    });
  });

  it('forwards selected studios filters to stashdb adapter', async () => {
    await service.getStudiosFeed(2, 25, {
      name: 'brazz',
      sort: 'UPDATED_AT',
      favoritesOnly: true,
    });

    expect(stashdbAdapter.getStudiosFeed).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 2,
      perPage: 25,
      name: 'brazz',
      sort: 'UPDATED_AT',
      direction: 'ASC',
      favoritesOnly: true,
    });
  });

  it('forwards explicit studios feed direction', async () => {
    await service.getStudiosFeed(1, 50, {
      sort: 'NAME',
      direction: 'DESC',
    });

    expect(stashdbAdapter.getStudiosFeed).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 1,
      perPage: 50,
      name: undefined,
      sort: 'NAME',
      direction: 'DESC',
      favoritesOnly: false,
    });
  });

  it('uses the active FANSDB provider for studio discovery', async () => {
    catalogProviderService.getConfiguredCatalogProvider = jest
      .fn()
      .mockResolvedValue({
        integrationType: 'FANSDB',
        providerKey: 'FANSDB',
        label: 'FansDB',
        baseUrl: 'http://fansdb.local/graphql',
        apiKey: 'fansdb-key',
      });

    await service.getStudiosFeed();

    expect(stashdbAdapter.getStudiosFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://fansdb.local/graphql',
        apiKey: 'fansdb-key',
      }),
    );
  });

  it('returns normalized studio details by id', async () => {
    await expect(service.getStudioById('studio-1')).resolves.toEqual({
      id: 'studio-1',
      name: 'Studio One',
      aliases: ['Alias One'],
      deleted: false,
      isFavorite: true,
      isNetworkFavorite: false,
      createdAt: '2024-01-01',
      updatedAt: '2024-02-01',
      imageUrl: 'http://studio-image',
      images: [
        {
          id: 'img-1',
          url: 'http://studio-image',
          width: 400,
          height: 220,
        },
      ],
      urls: [
        {
          url: 'https://stashdb.org/studios/studio-1',
          type: 'DETAILS',
          siteName: 'StashDB',
          siteUrl: 'https://stashdb.org',
          siteIcon: null,
        },
      ],
      parentStudio: {
        id: 'parent-1',
        name: 'Parent Studio',
        aliases: ['Parent Alias'],
        isFavorite: false,
        urls: [],
      },
      childStudios: [
        {
          id: 'child-1',
          name: 'Child Studio',
          aliases: [],
          deleted: false,
          isFavorite: false,
          createdAt: null,
          updatedAt: null,
          imageUrl: null,
        },
      ],
    });

    expect(stashdbAdapter.getStudioById).toHaveBeenCalledWith('studio-1', {
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
    });
  });

  it('stores a network favorite independently of the provider studio favorite', async () => {
    const key = { provider: 'STASHDB', studioId: 'studio-1' };
    await expect(service.setNetworkFavorite('studio-1', true)).resolves.toEqual({
      favorited: true,
    });
    expect(studioNetworkFavorite.createMany).toHaveBeenCalledWith({
      data: [key],
      skipDuplicates: true,
    });
    studioNetworkFavorite.findUnique.mockResolvedValue(key);
    await expect(service.getStudioById('studio-1')).resolves.toMatchObject({
      isFavorite: true,
      isNetworkFavorite: true,
    });
    expect(studioNetworkFavorite.findUnique).toHaveBeenCalledWith({
      where: { provider_studioId: key },
    });
    await expect(service.setNetworkFavorite('studio-1', false)).resolves.toEqual({
      favorited: false,
    });
    expect(studioNetworkFavorite.deleteMany).toHaveBeenCalledWith({ where: key });
    expect(stashdbAdapter.getStudioById).toHaveBeenCalledTimes(2);
  });

  it('rejects a new network favorite for a studio without children', async () => {
    jest.mocked(stashdbAdapter.getStudioById).mockResolvedValueOnce({
      ...(await stashdbAdapter.getStudioById('studio-1', stashdbIntegration)),
      childStudios: [],
    });
    await expect(service.setNetworkFavorite('studio-1', true)).rejects.toThrow(BadRequestException);
    expect(studioNetworkFavorite.createMany).not.toHaveBeenCalled();
  });

  it('rejects studio details fetch when id is empty', async () => {
    await expect(service.getStudioById('   ')).rejects.toThrow(
      'Studio id is required.',
    );
  });

  it('propagates not-found when studio details are missing', async () => {
    stashdbAdapter.getStudioById = jest
      .fn()
      .mockRejectedValue(new NotFoundException('missing'));

    await expect(service.getStudioById('studio-404')).rejects.toThrow(
      NotFoundException,
    );
  });
});
