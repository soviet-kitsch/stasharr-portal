import { ImportMatchReviewService } from './import-match-review.service';
import { IntegrationStatus } from '@prisma/client';

describe('ImportMatchReviewService', () => {
  let originalFetch: typeof fetch;
  const fetchMock = jest.fn();
  let integrations: any;
  let prisma: any;
  let whisparr: any;
  let service: ImportMatchReviewService;
  let indexing: any;
  const scene = (overrides: any = {}) => ({
    id: 'local-1',
    title: 'Local record',
    organized: false,
    files: [{ path: '/stash/Example.mp4', size: '2048' }],
    stash_ids: [],
    ...overrides,
  });
  const response = (scenes: any[], count = scenes.length) => ({
    ok: true,
    json: async () => ({ data: { findScenes: { count, scenes } } }),
  });
  beforeAll(() => {
    originalFetch = global.fetch;
    global.fetch = fetchMock;
  });
  afterAll(() => {
    global.fetch = originalFetch;
  });
  beforeEach(() => {
    jest.resetAllMocks();
    prisma = {
      sceneIndex: {
        findUnique: jest.fn().mockResolvedValue({
          stashId: 'catalog-1',
          stashLastSyncedAt: new Date('2026-10-27T10:00:00Z'),
        }),
      },
    };
    integrations = {
      findOne: jest.fn().mockImplementation(async (type) => ({
        enabled: true,
        status: IntegrationStatus.CONFIGURED,
        baseUrl: `http://${type.toLowerCase()}:9999`,
        browserUrl: `https://media.example/${type.toLowerCase()}`,
        apiKey: 'test-key',
      })),
    };
    whisparr = {
      findMovieByStashId: jest.fn().mockResolvedValue({
        movieId: 7,
        stashId: 'catalog-1',
        hasFile: true,
        filePath: '/whis/Example.mp4',
        fileSize: 2048,
      }),
      buildSceneViewUrl: jest.fn((base, id) => `${base}/movie/${id}`),
    };
    indexing = {
      requestImmediateRefresh: jest.fn().mockResolvedValue(undefined),
    };
    service = new ImportMatchReviewService(
      prisma,
      integrations,
      {
        getConfiguredCatalogProvider: jest
          .fn()
          .mockResolvedValue({ providerKey: 'STASHDB' }),
      } as any,
      whisparr,
      indexing,
    );
    fetchMock.mockResolvedValue(response([]));
  });
  it('shows a filename/size candidate with conflicting catalog id as unverified version guidance', async () => {
    fetchMock.mockResolvedValueOnce(response([])).mockResolvedValueOnce(
      response([
        scene({
          stash_ids: [
            {
              endpoint: 'https://stashdb.org/graphql',
              stash_id: 'different-version',
            },
          ],
        }),
      ]),
    );
    const result = await service.review('catalog-1');
    expect(result.condition).toBe('CATALOG_CONFLICT');
    expect(result.candidates[0]).toMatchObject({
      evidence: 'FILENAME_AND_SIZE',
      catalogIds: ['different-version'],
      viewUrl: 'https://media.example/stash/scenes/local-1',
    });
    expect(result.candidates[0].evidenceLabel).toContain('unverified');
    expect(result.nextSteps.join(' ')).toContain('version');
    expect(
      fetchMock.mock.calls.every(
        (call) => !JSON.parse(call[1].body).query.includes('mutation'),
      ),
    ).toBe(true);
    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      'http://stash:9999/graphql',
    );
    expect(result.whisparr.viewUrl).toBe(
      'https://media.example/whisparr/movie/7',
    );
  });
  it('recognizes a newly confirmed exact provider link and recommends refresh without a download', async () => {
    fetchMock.mockResolvedValueOnce(
      response([
        scene({
          stash_ids: [
            { endpoint: 'https://stashdb.org/graphql', stash_id: 'catalog-1' },
          ],
        }),
      ]),
    );
    const result = await service.review('catalog-1');
    expect(result.condition).toBe('MATCH_FOUND');
    expect(result.candidates[0].evidence).toBe('CATALOG_ID');
    expect(result.nextSteps.join(' ')).toContain('Refresh this scene');
  });
  it('never treats an inactive-provider id or a directory substring as an exact match', async () => {
    fetchMock.mockResolvedValue(
      response([
        scene({
          files: [{ path: '/Example.mp4.directory/Other.mp4', size: 2048 }],
          stash_ids: [
            { endpoint: 'https://fansdb.cc/graphql', stash_id: 'catalog-1' },
          ],
        }),
      ]),
    );
    const result = await service.review('catalog-1');
    expect(result.candidates).toEqual([]);
    expect(result.condition).toBe('NO_FILE_CANDIDATE');
    expect(result.limitations.join(' ')).toContain('filesystem');
  });
  it('keeps failed and malformed snapshots unverified rather than claiming absence', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        errors: [{ message: 'internal diagnostic with secret' }],
      }),
    });
    const result = await service.review('catalog-1');
    expect(result.condition).toBe('UNVERIFIED');
    expect(result.stash.state).toBe('UNAVAILABLE');
    expect(JSON.stringify(result)).not.toContain('internal diagnostic');
  });
  it('reports candidate truncation and preserves multiple copies for review', async () => {
    fetchMock.mockResolvedValueOnce(response([])).mockResolvedValueOnce(
      response(
        Array.from({ length: 20 }, (_, id) => scene({ id: `local-${id}` })),
        80,
      ),
    );
    const result = await service.review('catalog-1');
    expect(result.candidates).toHaveLength(20);
    expect(result.stash.candidatesTruncated).toBe(true);
    expect(result.limitations.join(' ')).toContain('first 20');
  });
  it('does not call an empty catalog record with no files available', async () => {
    fetchMock.mockResolvedValueOnce(
      response([
        scene({
          files: [],
          stash_ids: [
            { endpoint: 'https://stashdb.org/graphql', stash_id: 'catalog-1' },
          ],
        }),
      ]),
    );
    expect((await service.review('catalog-1')).condition).not.toBe(
      'MATCH_FOUND',
    );
  });
  it('omits filename lookup when no actual imported file path is supplied', async () => {
    whisparr.findMovieByStashId.mockResolvedValue({
      movieId: 7,
      hasFile: true,
    });
    const result = await service.review('catalog-1');
    expect(result.whisparr.filePath).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.nextSteps.join(' ')).toContain('scan');
  });
  it('refuses unknown acquisition ids before contacting either provider', async () => {
    prisma.sceneIndex.findUnique.mockResolvedValue(null);
    await expect(service.review('unknown')).rejects.toThrow(
      'no acquisition evidence',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(whisparr.findMovieByStashId).not.toHaveBeenCalled();
  });
  it.each([
    [1, []],
    [3, [scene()]],
    [2, [scene(), scene()]],
  ])(
    'keeps short or duplicate result pages unverified (reported %s)',
    async (count, scenes) => {
      fetchMock.mockResolvedValue(response(scenes, count));
      const result = await service.review('catalog-1');
      expect(result.condition).toBe('UNVERIFIED');
      expect(result.stash.state).toBe('UNAVAILABLE');
      expect(result.candidates).toEqual([]);
    },
  );
  it('links a unique candidate directly, but never chooses between multiple file candidates', async () => {
    fetchMock
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([scene()]));
    expect((await service.review('catalog-1')).stash.viewUrl).toBe(
      'https://media.example/stash/scenes/local-1',
    );
    fetchMock
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([scene(), scene({ id: 'local-2' })]));
    const multiple = await service.review('catalog-1');
    expect(multiple.stash.viewUrl).toBeNull();
    expect(multiple.candidates).toHaveLength(2);
    fetchMock.mockResolvedValue(response([]));
    expect((await service.review('catalog-1')).stash.viewUrl).toBeNull();
  });
  it('refreshes observations for the requested scene and reports the actual resulting lifecycle', async () => {
    fetchMock.mockResolvedValueOnce(
      response([
        scene({
          stash_ids: [
            { endpoint: 'https://stashdb.org/graphql', stash_id: 'catalog-1' },
          ],
        }),
      ]),
    );
    prisma.sceneIndex.findUnique
      .mockResolvedValueOnce({ stashId: 'catalog-1' })
      .mockResolvedValueOnce({ computedLifecycle: 'AVAILABLE' });
    const result = await service.reconcile('catalog-1');
    expect(indexing.requestImmediateRefresh).toHaveBeenCalledWith(
      ['catalog-1'],
      'import-recovery',
    );
    expect(result.portalStatus).toBe('AVAILABLE');
    expect(result.reconciliationMessage).toContain('available');
    expect(
      fetchMock.mock.calls.every(
        (call) => !JSON.parse(call[1].body).query.includes('mutation'),
      ),
    ).toBe(true);
  });
  it('does not claim a filename candidate or a conflicting link was repaired', async () => {
    fetchMock
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([scene()]));
    prisma.sceneIndex.findUnique.mockResolvedValue({
      computedLifecycle: 'IMPORT_PENDING',
    });
    const result = await service.reconcile('catalog-1');
    expect(result.portalStatus).toBe('IMPORT_PENDING');
    expect(result.reconciliationMessage).toContain('still needs');
  });
  it('refuses reconciliation while either live provider is unavailable', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(service.reconcile('catalog-1')).rejects.toThrow(
      'both be verified',
    );
    expect(indexing.requestImmediateRefresh).not.toHaveBeenCalled();
  });
  it('shows source-identity matches as available rather than reporting a catalog conflict', async () => {
    fetchMock
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(
        response([
          scene({
            stash_ids: [
              {
                endpoint: 'https://stashdb.org/graphql',
                stash_id: 'alternate',
              },
            ],
          }),
        ]),
      );
    (service as any).stashAdapter = {
      findScenesByStashId: jest
        .fn()
        .mockResolvedValue([
          {
            id: 'local-1',
            viewUrl: 'https://media.example/stash/scenes/local-1',
            evidence: 'SOURCE_IDENTITY',
            sourceIdentity: {
              title: 'Local record',
              catalogIds: ['alternate'],
              files: [{ path: '/stash/Example.mp4', size: 2048 }],
            },
          },
        ]),
    };
    const result = await service.review('catalog-1');
    expect(result.condition).toBe('MATCH_FOUND');
    expect(result.summary).toContain('another catalog ID');
    expect(result.candidates[0].evidence).toBe('SOURCE_IDENTITY');
    expect(result.stash.viewUrl).toBe(
      'https://media.example/stash/scenes/local-1',
    );
  });
});
