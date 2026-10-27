import { LibrarySceneQueryService } from './library-scene-query.service';
import { PrismaService } from '../prisma/prisma.service';

describe('library browser links', () => {
  it('rebuilds cached links from the latest browser address on every read', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      baseUrl: 'http://stash:9999',
      browserUrl: 'https://first.example/library',
    });
    const findMany = jest.fn().mockResolvedValue([
      {
        stashSceneId: '42',
        linkedStashId: null,
        imageUrl: null,
        studioId: null,
        studioImageUrl: null,
        viewUrl: 'http://outdated-internal:9999/scenes/42',
      },
    ]);
    const service = new LibrarySceneQueryService({
      integrationConfig: { findUnique },
      librarySceneIndex: {
        findMany,
        aggregate: jest.fn().mockResolvedValue({
          _count: { _all: 1 },
          _max: { lastSyncedAt: null },
        }),
      },
    } as unknown as PrismaService);
    expect((await service.getScenesFeed()).items[0].viewUrl).toBe(
      'https://first.example/library/scenes/42',
    );
    findUnique.mockResolvedValue({
      baseUrl: 'http://stash:9999/prefix/graphql',
      browserUrl: 'https://second.example/media',
    });
    expect((await service.getScenesPreview(1))[0].viewUrl).toBe(
      'https://second.example/media/scenes/42',
    );
    findUnique.mockResolvedValue({
      baseUrl: 'http://stash:9999/prefix/graphql',
      browserUrl: null,
    });
    expect((await service.getScenesFeed()).items[0].viewUrl).toBe(
      'http://stash:9999/prefix/scenes/42',
    );
  });
});
