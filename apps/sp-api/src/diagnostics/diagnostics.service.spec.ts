import { DiagnosticsService } from './diagnostics.service';
import { evidenceId } from './diagnostics.util';

function fixture() {
  const eventRows = new Map<string, any>();
  const attempts = new Map<string, any>();
  const config = {
    id: 'integration',
    baseUrl: 'http://whisparr.internal',
    browserUrl: 'http://user/whisparr',
    apiKey: 'secret',
    enabled: true,
    status: 'CONFIGURED',
  };
  const source = evidenceId('WHISPARR', config.id, config.baseUrl);
  const sync = { since: new Date(Date.now() - 86400_000), checkedAt: null };
  const db: any = {
    requestDiagnosticEvent: {
      upsert: jest.fn(async ({ create }: any) => {
        if (!eventRows.has(create.id)) eventRows.set(create.id, create);
        return eventRows.get(create.id);
      }),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    requestSearchAttempt: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        attempts.set(
          where.id,
          attempts.has(where.id)
            ? { ...attempts.get(where.id), ...update }
            : create,
        );
        return attempts.get(where.id);
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { ...data, createdAt: new Date() };
        attempts.set(data.id, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = { ...attempts.get(where.id), ...data };
        attempts.set(where.id, row);
        return row;
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn(
        async ({ where }: any) => attempts.get(where.id) ?? null,
      ),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    requestAction: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    },
    request: {
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn(),
    },
    requestDiagnosticSync: {
      upsert: jest.fn().mockResolvedValue(sync),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(sync),
    },
    sceneIndex: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _max: { updatedAt: null } }),
    },
    requestDiagnosticObservation: {
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn(),
      aggregate: jest
        .fn()
        .mockResolvedValue({ _max: { checkedAt: null, metadataAt: null } }),
    },
    hydraSearchSettings: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(({ create }: any) => create),
    },
    $executeRaw: jest.fn(),
  };
  db.$transaction = jest.fn((work: any) => work(db));
  const whis: any = {
    getMovieSnapshot: jest
      .fn()
      .mockResolvedValue([{ movieId: 7, stashId: 'scene' }]),
    getSearchCommands: jest.fn().mockResolvedValue([]),
    findMovieByStashId: jest
      .fn()
      .mockResolvedValue({ movieId: 7, hasFile: false }),
    buildSceneViewUrl: jest.fn(),
  };
  const integrations: any = { findOne: jest.fn().mockResolvedValue(config) };
  const indexing: any = {
    getAcquisitionEvidence: jest
      .fn()
      .mockResolvedValue({ sourcesReady: false, states: [] }),
    toSceneStatus: jest.fn(),
  };
  const operations: any = {
    run: jest.fn(async (_id, _key, _kind, _body, work) =>
      work(jest.fn().mockResolvedValue(undefined)),
    ),
  };
  const catalog: any = {
    getConfiguredCatalogProvider: jest
      .fn()
      .mockResolvedValue({ providerKey: 'STASHDB', baseUrl: 'http://catalog' }),
    getConfiguredCatalogProviderOrNull: jest.fn().mockResolvedValue(null),
  };
  const service = new DiagnosticsService(
    db,
    integrations,
    indexing,
    whis,
    operations,
    catalog,
    {} as any,
  );
  const native = jest.spyOn(service as any, 'native').mockResolvedValue([]);
  return {
    service,
    db,
    native,
    config,
    source,
    eventRows,
    attempts,
    whis,
    integrations,
    operations,
  };
}

describe('automatic request observations', () => {
  it('captures native search completion without a UI and never invents release counts', async () => {
    const f = fixture();
    const ended = new Date().toISOString();
    f.native.mockImplementation(async (_cfg: any, path: any) =>
      path === 'command'
        ? [
            {
              name: 'MoviesSearch',
              id: 12,
              body: { movieIds: [7] },
              status: 'completed',
              queued: ended,
              ended,
            },
          ]
        : [],
    );
    await f.service.observe();
    await f.service.observe();
    expect(f.attempts.size).toBe(1);
    expect([...f.attempts.values()][0]).toMatchObject({
      mode: 'AUTOMATIC',
      state: 'completed',
      outcome: 'UNKNOWN',
      finishedAt: new Date(ended),
    });
    expect([...f.attempts.values()][0].candidateCount).toBeUndefined();
    expect(f.eventRows.size).toBe(1);
    expect(
      f.native.mock.calls.some((call) => String(call[1]).startsWith('release')),
    ).toBe(false);
  });
  it('keeps a history checkpoint when a response is incomplete', async () => {
    const f = fixture();
    f.native.mockImplementation(async (_cfg: any, path: any) =>
      path === 'command' ? [] : { records: [] },
    );
    await expect(f.service.observe()).rejects.toThrow('History incomplete');
    expect(
      f.db.requestDiagnosticSync.update.mock.calls.some(
        ([arg]: any) => arg.where.source === f.source,
      ),
    ).toBe(false);
    expect(f.db.requestDiagnosticSync.updateMany).toHaveBeenCalled();
  });
  it('keeps Portal action evidence even if Whisparr is disabled', async () => {
    const f = fixture();
    f.db.requestAction.findMany.mockResolvedValue([
      {
        id: 'action',
        stashId: 'scene',
        kind: 'RE_REQUEST',
        state: 'SUCCEEDED',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    f.integrations.findOne.mockResolvedValue({ ...f.config, enabled: false });
    await expect(f.service.observe()).rejects.toThrow('Configure Whisparr');
    expect([...f.eventRows.values()].some((r) => r.source === 'PORTAL')).toBe(
      true,
    );
    expect(f.native).not.toHaveBeenCalled();
  });
  it('retains stored history when an integration is unavailable', async () => {
    const f = fixture();
    f.integrations.findOne.mockRejectedValue(new Error('not configured'));
    const details = await f.service.details('scene');
    expect(details.events).toEqual([]);
    expect(details.whisparrUrl).toBeNull();
    expect(f.native).not.toHaveBeenCalled();
  });
  it('uses stable timestamp/id cursor boundaries for simultaneous events', async () => {
    const f = fixture();
    const at = new Date().toISOString(),
      id = 'a'.repeat(64);
    await f.service.details(
      'scene',
      Buffer.from(JSON.stringify({ at, id })).toString('base64url'),
    );
    expect(
      f.db.requestDiagnosticEvent.findMany.mock.calls[0][0].where.OR,
    ).toEqual([
      { occurredAt: { lt: new Date(at) } },
      { occurredAt: new Date(at), id: { lt: id } },
    ]);
    await expect(f.service.details('scene', 'malformed')).rejects.toThrow(
      'Invalid history cursor',
    );
  });
  it('returns cached thumbnail URLs without requesting catalog metadata', async () => {
    const f = fixture();
    f.db.sceneIndex.findMany.mockResolvedValue([
      {
        stashId: 'pictured',
        imageUrl: 'https://images.example/scene.jpg?size=1200',
        diagnostics: null,
      },
      { stashId: 'missing', imageUrl: null, diagnostics: null },
    ]);
    const result = await f.service.table({});
    expect(result.items.map((row) => [row.imageUrl, row.cardImageUrl])).toEqual(
      [
        [
          'https://images.example/scene.jpg?size=1200',
          'https://images.example/scene.jpg?size=320',
        ],
        [null, null],
      ],
    );
    expect(f.native).not.toHaveBeenCalled();
  });
  it('builds row-level Whisparr links using the browser URL and only known scene mappings', async () => {
    const f = fixture();
    f.whis.buildSceneViewUrl.mockImplementation(
      (base: string, id: number) => base + '/movie/' + id,
    );
    f.db.sceneIndex.findMany.mockResolvedValue([
      {
        stashId: 'known',
        whisparrMovieId: 7,
        imageUrl: null,
        diagnostics: null,
      },
      {
        stashId: 'missing',
        whisparrMovieId: null,
        imageUrl: null,
        diagnostics: null,
      },
    ]);
    const result = await f.service.table({});
    expect(result.items.map((row) => row.whisparrViewUrl)).toEqual([
      'http://user/whisparr/movie/7',
      null,
    ]);
    expect(f.whis.buildSceneViewUrl).toHaveBeenCalledTimes(1);
    expect(f.native).not.toHaveBeenCalled();
  });
  it('preserves text filtering when adding an unknown-evidence blocker', async () => {
    const f = fixture();
    await f.service.table({ q: 'Example', blocker: 'UNKNOWN' });
    const where = f.db.sceneIndex.findMany.mock.calls[0][0].where;
    expect(where.AND[0].OR[0].title.contains).toBe('Example');
    // With unavailable sources, only the status-refresh filter is valid.
    expect(where.AND[1]).toEqual({ stashId: { in: [] } });
  });
});

describe('explicit diagnostic searches', () => {
  it('persists results using the acquisition claim and never sends a grab', async () => {
    const f = fixture();
    f.native.mockResolvedValue([
      {
        title: 'Example',
        approved: false,
        rejected: true,
        rejections: ['Size limit'],
        mappedMovieId: 7,
      },
    ]);
    await f.service.start('scene', 'operation');
    await new Promise(setImmediate);
    expect(f.operations.run).toHaveBeenCalledWith(
      'scene',
      'operation',
      'DIAGNOSTIC_SEARCH',
      expect.anything(),
      expect.any(Function),
    );
    expect(f.attempts.get('operation')).toMatchObject({
      state: 'COMPLETED',
      outcome: 'ALL_REJECTED',
      candidateCount: 1,
    });
    expect(f.native).toHaveBeenCalledTimes(1);
    expect(f.native.mock.calls[0][1]).toBe('release?movieId=7');
    await f.service.start('scene', 'operation');
    expect(f.native).toHaveBeenCalledTimes(1);
  });
  it('does not replay a dispatched attempt after a timeout', async () => {
    const f = fixture();
    f.native.mockRejectedValue(new Error('timeout'));
    f.db.requestAction.findUnique.mockResolvedValue({
      dispatchedAt: new Date(),
    });
    await f.service.start('scene', 'operation');
    await new Promise(setImmediate);
    expect(f.attempts.get('operation')).toMatchObject({
      state: 'UNCERTAIN',
      outcome: 'INCOMPLETE',
    });
    await f.service.start('scene', 'operation');
    expect(f.native).toHaveBeenCalledTimes(1);
  });
  it('blocks a conflicting native search and an existing imported file', async () => {
    const f = fixture();
    f.whis.getSearchCommands.mockResolvedValue([
      { movieIds: [7], status: 'started' },
    ]);
    await expect(f.service.start('scene', 'operation')).rejects.toThrow(
      'already searching',
    );
    f.whis.getSearchCommands.mockResolvedValue([]);
    f.whis.findMovieByStashId.mockResolvedValue({ movieId: 7, hasFile: true });
    await expect(f.service.start('scene', 'operation')).rejects.toThrow(
      'existing file',
    );
    expect(f.native).not.toHaveBeenCalled();
  });
  it('retains an interrupted attempt on startup without resubmission', async () => {
    const f = fixture();
    jest.spyOn(f.service, 'observe').mockResolvedValue(undefined);
    await f.service.onApplicationBootstrap();
    expect(f.db.requestSearchAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { state: 'UNCERTAIN', outcome: 'INCOMPLETE' },
      }),
    );
    expect(f.operations.run).not.toHaveBeenCalled();
  });
  it('rejects a key for a different scene and credential-bearing browser URLs', async () => {
    const f = fixture();
    f.attempts.set('operation', { stashId: 'another', mode: 'DIAGNOSTIC' });
    await expect(f.service.start('scene', 'operation')).rejects.toThrow(
      'another search',
    );
    await expect(
      f.service.saveSettings({
        browserUrl: 'https://user:password@host',
        studio: true,
        performers: true,
        title: false,
      }),
    ).rejects.toThrow('HTTP(S)');
    expect(f.db.hydraSearchSettings.upsert).not.toHaveBeenCalled();
  });
});
