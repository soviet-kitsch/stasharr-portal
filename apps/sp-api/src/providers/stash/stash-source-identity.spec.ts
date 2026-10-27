import { StashAdapter } from './stash.adapter';
import {
  CatalogSourceIdentityService,
  sceneSourceUrl,
} from '../catalog/catalog-source-identity.service';

const url = 'https://example.test/1791548/scene.html';
const candidate = () => ({
  id: '128',
  title: 'Local scene',
  urls: [url],
  stash_ids: [
    { endpoint: 'https://stashdb.org/graphql', stash_id: 'alternate' },
  ],
  studio: {
    stash_ids: [
      { endpoint: 'https://stashdb.org/graphql', stash_id: 'studio-1' },
    ],
  },
  files: [
    {
      path: '/library/video.mp4',
      size: 2807983842,
      duration: 3668.07,
      width: 1920,
      height: 1080,
    },
  ],
});

describe('Stash duplicate catalog source identity', () => {
  let oldFetch: typeof fetch;
  let fetchMock: jest.Mock;
  let adapter: StashAdapter;
  let identities: any;
  beforeEach(() => {
    oldFetch = global.fetch;
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    identities = {
      get: jest
        .fn()
        .mockResolvedValue({
          urls: [url],
          studioId: 'studio-1',
          duration: 3675,
        }),
    };
    adapter = new StashAdapter(
      { recordSuccess: jest.fn(), recordFailure: jest.fn() } as any,
      identities,
    );
  });
  afterEach(() => {
    global.fetch = oldFetch;
  });
  function response(scenes: any[], count = scenes.length) {
    return {
      ok: true,
      json: async () => ({ data: { findScenes: { count, scenes } } }),
    };
  }
  async function find(scene: any, count = 1) {
    fetchMock
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([scene], count));
    return adapter.findScenesByStashId(
      'requested',
      { baseUrl: 'http://stash:9999', browserUrl: 'https://media.test/stash' },
      { providerKey: 'STASHDB' },
    );
  }
  it('recognizes the same official page, provider-qualified studio and near-identical file duration despite another catalog ID', async () => {
    const copies = await find(candidate());
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({
      id: '128',
      evidence: 'SOURCE_IDENTITY',
      viewUrl: 'https://media.test/stash/scenes/128',
      sourceIdentity: {
        catalogIds: ['alternate'],
        files: [{ path: '/library/video.mp4', size: 2807983842 }],
      },
    });
    const queries = fetchMock.mock.calls.map((call) =>
      JSON.parse(call[1].body),
    );
    expect(queries[1].variables.sceneFilter).toEqual({
      url: { value: url, modifier: 'EQUALS' },
    });
    expect(queries.every((body) => !body.query.includes('mutation'))).toBe(
      true,
    );
  });
  it.each([
    'different-url',
    'different-studio',
    'different-provider',
    'different-duration',
    'no-file',
    'no-catalog-link',
  ])('refuses %s rather than trusting title or filename', async (reason) => {
    const scene = candidate();
    if (reason === 'different-url')
      scene.urls = ['https://example.test/9999999/other.html'];
    if (reason === 'different-studio')
      scene.studio.stash_ids[0].stash_id = 'another';
    if (reason === 'different-provider')
      scene.studio.stash_ids[0].endpoint = 'https://fansdb.cc/graphql';
    if (reason === 'different-duration') scene.files[0].duration = 3800;
    if (reason === 'no-file') scene.files = [];
    if (reason === 'no-catalog-link') scene.stash_ids = [];
    expect(await find(scene)).toEqual([]);
  });
  it('fails closed on an incomplete response', async () => {
    await expect(find(candidate(), 3)).rejects.toThrow('incomplete');
  });
  it('keeps native exact-ID matches on the existing fast path', async () => {
    const scene = candidate();
    scene.stash_ids[0].stash_id = 'requested';
    fetchMock.mockResolvedValueOnce(response([scene]));
    expect(
      await adapter.findScenesByStashId(
        'requested',
        { baseUrl: 'http://stash:9999' },
        { providerKey: 'STASHDB' },
      ),
    ).toHaveLength(1);
    expect(identities.get).not.toHaveBeenCalled();
  });
  it('preserves favorite filters on the source URL lookup', async () => {
    fetchMock.mockResolvedValue(response([]));
    await adapter.findScenesByStashId(
      'requested',
      { baseUrl: 'http://stash:9999' },
      { providerKey: 'STASHDB', favoriteStudiosOnly: true },
    );
    const query = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(query.variables.sceneFilter.studios_filter).toEqual({
      favorite: true,
    });
  });
  it('rejects homepages and generic collection links while preserving meaningful query IDs', () => {
    expect(sceneSourceUrl('https://example.test/')).toBeNull();
    expect(sceneSourceUrl('https://example.test/catalog/scenes')).toBeNull();
    expect(sceneSourceUrl('https://example.test/scene.php?id=123456')).not.toBe(
      sceneSourceUrl('https://example.test/scene.php?id=654321'),
    );
  });
});

describe('Catalog source identities', () => {
  it('reads only the selected configured provider and obtains its authoritative source URL', async () => {
    const prisma: any = {
      integrationConfig: {
        findUnique: jest
          .fn()
          .mockResolvedValue({
            enabled: true,
            status: 'CONFIGURED',
            baseUrl: 'https://stashdb.org',
            apiKey: 'private-key',
          }),
      },
    };
    const catalog: any = {
      getSceneById: jest
        .fn()
        .mockResolvedValue({
          studioId: 'studio-1',
          duration: 3675,
          sourceUrls: [{ url }, { url: 'https://example.test/' }],
        }),
    };
    const identity = await new CatalogSourceIdentityService(
      prisma,
      catalog,
    ).get('requested', 'STASHDB');
    expect(identity).toEqual({
      urls: [url],
      studioId: 'studio-1',
      duration: 3675,
    });
    expect(prisma.integrationConfig.findUnique).toHaveBeenCalledWith({
      where: { type: 'STASHDB' },
    });
  });
});
