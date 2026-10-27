import { ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { RequestsService } from './requests.service';
import { BatchRequestActionDto } from './dto/request-action.dto';

function fixture() {
  const index = {
    refreshRequestRow: jest.fn().mockResolvedValue(undefined),
    requestImmediateRefresh: jest.fn().mockResolvedValue(undefined),
    seedRequestedScene: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    findOne: jest.fn().mockResolvedValue({
      enabled: true,
      status: 'CONFIGURED',
      baseUrl: 'http://fixture.invalid',
      apiKey: 'fixture',
    }),
  };
  const catalog = {
    getConfiguredCatalogProvider: jest.fn().mockResolvedValue({
      providerKey: 'STASHDB',
      baseUrl: 'http://fixture.invalid',
    }),
  };
  const whis = {
    findMovieByStashId: jest
      .fn()
      .mockResolvedValue({ movieId: 42, stashId: 'scene', hasFile: false }),
    getQueueSnapshot: jest.fn().mockResolvedValue([]),
    getSearchCommands: jest.fn().mockResolvedValue([]),
    searchMovie: jest.fn().mockResolvedValue({ commandId: 7 }),
    createMovie: jest.fn(),
    getRootFolders: jest
      .fn()
      .mockResolvedValue([{ path: '/data', accessible: true }]),
    getQualityProfiles: jest.fn().mockResolvedValue([{ id: 1 }]),
    getTags: jest.fn().mockResolvedValue([]),
  };
  const stash = { findScenesByStashId: jest.fn().mockResolvedValue([]) };
  const metadata = {
    getSceneById: jest.fn().mockResolvedValue({
      id: 'scene',
      title: 'Example',
      studioName: 'Studio',
    }),
  };
  const db = {
    request: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ revision: 1 }),
      upsert: jest.fn().mockResolvedValue({
        status: 'REQUESTED',
        revision: 1,
        updatedAt: new Date(),
      }),
    },
    requestAction: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const dispatch = jest.fn().mockResolvedValue(undefined);
  const operations = {
    run: jest.fn((_id, _key, _kind, _payload, work) => work(dispatch)),
    finish: jest.fn().mockResolvedValue(undefined),
  };
  const service = new RequestsService(
    index as never,
    config as never,
    catalog as never,
    whis as never,
    metadata as never,
    db as never,
    operations as never,
    stash as never,
  );
  return {
    service,
    index,
    whis,
    stash,
    metadata,
    db,
    dispatch,
    operations,
    config,
  };
}

describe('request recovery actions', () => {
  const settings = {
    monitored: true,
    searchForMovie: true,
    rootFolderPath: '/data',
    qualityProfileId: 1,
    tags: [],
  };

  it('checks Stash before re-requesting and sends no acquisition for an owned scene', async () => {
    const f = fixture();
    f.stash.findScenesByStashId.mockResolvedValue([{ id: 'local' }] as never);
    expect(
      await f.service.submitSceneRequest('scene', settings, 'RE_REQUEST'),
    ).toMatchObject({ alreadyExists: true });
    expect(f.whis.createMovie).not.toHaveBeenCalled();
    expect(f.dispatch).not.toHaveBeenCalled();
    expect(f.index.seedRequestedScene).toHaveBeenCalledWith(
      expect.objectContaining({ stashAvailable: true }),
    );
  });

  it('resumes a waiting existing Whisparr entry with one guarded search and no duplicate entry', async () => {
    const f = fixture();
    expect(
      await f.service.submitSceneRequest('scene', settings, 'RE_REQUEST'),
    ).toMatchObject({ alreadyExists: true, whisparrMovieId: 42 });
    expect(f.whis.createMovie).not.toHaveBeenCalled();
    expect(f.whis.searchMovie).toHaveBeenCalledTimes(1);
    expect(f.dispatch).toHaveBeenCalledWith({
      operation: 'SEARCH_MOVIE',
      movieId: 42,
    });
  });

  it('creates only an absent scene, marking dispatch and saving reviewed settings', async () => {
    const f = fixture();
    f.whis.findMovieByStashId.mockResolvedValue(null);
    f.whis.createMovie.mockResolvedValue({ movieId: 50 });
    await f.service.submitSceneRequest('scene', settings, 'RE_REQUEST');
    expect(f.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ settings }),
    );
    expect(f.db.request.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ settings }),
      }),
    );
  });

  it('does not search again for an imported file, a queued download or an existing search', async () => {
    const f = fixture();
    f.whis.findMovieByStashId.mockResolvedValue({
      movieId: 42,
      stashId: 'scene',
      hasFile: true,
    });
    await expect(f.service.searchAgain('scene', randomUUID())).rejects.toThrow(
      'already has the file',
    );
    f.whis.findMovieByStashId.mockResolvedValue({
      movieId: 42,
      stashId: 'scene',
      hasFile: false,
    });
    f.whis.getQueueSnapshot.mockResolvedValue([{ movieId: 42 }] as never);
    expect(await f.service.searchAgain('scene', randomUUID())).toMatchObject({
      outcome: 'ALREADY_QUEUED',
    });
    f.whis.getQueueSnapshot.mockResolvedValue([]);
    f.whis.getSearchCommands.mockResolvedValue([
      { id: 3, movieIds: [42], status: 'started' },
    ] as never);
    expect(await f.service.searchAgain('scene', randomUUID())).toMatchObject({
      outcome: 'ALREADY_SEARCHING',
    });
    expect(f.whis.searchMovie).not.toHaveBeenCalled();
  });

  it('searches one existing movie without changing its monitoring settings', async () => {
    const f = fixture();
    expect(await f.service.searchAgain('scene', randomUUID())).toMatchObject({
      outcome: 'SEARCH_STARTED',
      commandId: 7,
    });
    expect(f.whis.searchMovie).toHaveBeenCalledWith(42, expect.any(Object));
    expect(f.whis.createMovie).not.toHaveBeenCalled();
  });

  it('removes and restores only Portal intent, leaving upstream APIs untouched', async () => {
    const f = fixture();
    await f.service.setDismissed('scene', randomUUID(), true);
    expect(f.db.request.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { dismissedAt: expect.any(Date), revision: { increment: 1 } },
      }),
    );
    await f.service.setDismissed('scene', randomUUID(), false);
    expect(f.db.request.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: { dismissedAt: null, revision: { increment: 1 } },
      }),
    );
    expect(f.whis.findMovieByStashId).not.toHaveBeenCalled();
    expect(f.whis.createMovie).not.toHaveBeenCalled();
  });

  it('leaves a genuinely uncertain missing submission blocked instead of sending again', async () => {
    const f = fixture();
    f.db.request.findUnique.mockResolvedValue({
      activeActionId: 'pending',
    } as never);
    f.db.requestAction.findUnique.mockResolvedValue({
      id: 'pending',
      state: 'UNCERTAIN',
      kind: 'REQUEST',
      dispatchedAt: new Date(0),
    });
    f.whis.findMovieByStashId.mockResolvedValue(null);
    await expect(f.service.checkOutcome('scene')).rejects.toThrow(
      'still unknown',
    );
    expect(f.operations.finish).not.toHaveBeenCalled();
    expect(f.whis.createMovie).not.toHaveBeenCalled();
  });

  it('recovers a confirmed submission by observation without creating it again', async () => {
    const f = fixture();
    f.db.request.findUnique.mockResolvedValue({
      activeActionId: 'pending',
    } as never);
    f.db.requestAction.findUnique.mockResolvedValue({
      id: 'pending',
      state: 'UNCERTAIN',
      kind: 'REQUEST',
      dispatchedAt: new Date(0),
      details: { settings },
    });
    expect(await f.service.checkOutcome('scene')).toMatchObject({
      outcome: 'REQUEST_CONFIRMED',
    });
    expect(f.operations.finish).toHaveBeenCalledWith(
      'scene',
      'pending',
      'SUCCEEDED',
      expect.any(Object),
    );
    expect(f.whis.createMovie).not.toHaveBeenCalled();
  });

  it('returns per-scene batch results and continues after a rejected scene', async () => {
    const f = fixture();
    jest
      .spyOn(f.service, 'searchAgain')
      .mockRejectedValueOnce(new ConflictException('Already imported'))
      .mockResolvedValueOnce({ outcome: 'SEARCH_STARTED' });
    const result = await f.service.executeBatch({
      kind: 'SEARCH',
      ids: ['one', 'two'],
      operationKey: randomUUID(),
    });
    expect(result.results.map((row) => row.ok)).toEqual([false, true]);
  });

  it('previews deletes without changing Portal or Whisparr data', async () => {
    const f = fixture();
    await f.service.previewBatch({
      kind: 'DISMISS',
      ids: ['one'],
      operationKey: randomUUID(),
    });
    expect(f.db.request.update).not.toHaveBeenCalled();
    expect(f.operations.run).not.toHaveBeenCalled();
  });

  it.each([
    { ids: [] },
    { ids: Array.from({ length: 21 }, (_, i) => 'scene-' + i) },
    { ids: ['same', 'same'] },
  ])('rejects an empty, oversized or duplicate batch %#', async ({ ids }) => {
    const dto = plainToInstance(BatchRequestActionDto, {
      ids,
      kind: 'SEARCH',
      operationKey: randomUUID(),
    });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });

  it('uses the sole valid option for a legacy request and restores valid saved settings', async () => {
    const f = fixture();
    f.db.request.findUnique.mockResolvedValue({ settings: null } as never);
    const legacy = await f.service.getRequestOptions('scene');
    expect(legacy.defaults.rootFolderPath).toBe('/data');
    expect(legacy.defaults.qualityProfileId).toBe(1);
    expect(legacy.defaultSources).toEqual({
      rootFolderPath: 'ONLY_OPTION',
      qualityProfileId: 'ONLY_OPTION',
    });
    f.db.request.findUnique.mockResolvedValue({
      settings: { ...settings, monitored: false },
    } as never);
    const saved = await f.service.getRequestOptions('scene');
    expect(saved.defaults).toMatchObject({
      rootFolderPath: '/data',
      qualityProfileId: 1,
      monitored: false,
    });
  });
  it('prefills configured defaults before arbitrary option order, while saved valid values win', async () => {
    const f = fixture();
    f.config.findOne.mockResolvedValue({
      enabled: true,
      status: 'CONFIGURED',
      baseUrl: 'http://fixture.invalid',
      apiKey: 'fixture',
      defaultRootFolderPath: '/preferred',
      defaultQualityProfileId: 2,
    } as never);
    f.whis.getRootFolders.mockResolvedValue([
      { path: '/other', accessible: true },
      { path: '/preferred', accessible: true },
    ] as never);
    f.whis.getQualityProfiles.mockResolvedValue([
      { id: 1 },
      { id: 2 },
    ] as never);
    f.db.request.findUnique.mockResolvedValue({ settings: null } as never);
    const legacy = await f.service.getRequestOptions('scene');
    expect(legacy.defaults).toMatchObject({
      rootFolderPath: '/preferred',
      qualityProfileId: 2,
    });
    expect(legacy.defaultSources).toEqual({
      rootFolderPath: 'CONFIGURED',
      qualityProfileId: 'CONFIGURED',
    });
    f.db.request.findUnique.mockResolvedValue({
      settings: { ...settings, rootFolderPath: '/other' },
    } as never);
    const saved = await f.service.getRequestOptions('scene');
    expect(saved.defaults).toMatchObject({
      rootFolderPath: '/other',
      qualityProfileId: 1,
    });
    expect(saved.defaultSources).toEqual({
      rootFolderPath: 'SAVED',
      qualityProfileId: 'SAVED',
    });
    const batch = await f.service.getRequestOptions('scene', 'batch');
    expect(batch.defaults).toMatchObject({
      rootFolderPath: '/preferred',
      qualityProfileId: 2,
    });
    expect(batch.defaultSources).toEqual({
      rootFolderPath: 'CONFIGURED',
      qualityProfileId: 'CONFIGURED',
    });
  });

  it('does not choose the first of multiple options when saved or configured defaults are invalid', async () => {
    const f = fixture();
    f.config.findOne.mockResolvedValue({
      enabled: true,
      status: 'CONFIGURED',
      baseUrl: 'http://fixture.invalid',
      apiKey: 'fixture',
      defaultRootFolderPath: '/unavailable',
      defaultQualityProfileId: 99,
    } as never);
    f.db.request.findUnique.mockResolvedValue({
      settings: { ...settings, rootFolderPath: '/gone', qualityProfileId: 88 },
    } as never);
    f.whis.getRootFolders.mockResolvedValue([
      { path: '/unavailable', accessible: false },
      { path: '/a', accessible: true },
      { path: '/b', accessible: true },
    ] as never);
    f.whis.getQualityProfiles.mockResolvedValue([
      { id: 1 },
      { id: 2 },
    ] as never);
    const options = await f.service.getRequestOptions('scene');
    expect(options.defaults).toMatchObject({
      rootFolderPath: null,
      qualityProfileId: null,
    });
    expect(options.defaultSources).toEqual({
      rootFolderPath: 'REQUIRED',
      qualityProfileId: 'REQUIRED',
    });
  });

  it('does not require creation settings to resume an existing active job', async () => {
    const f = fixture();
    f.whis.getQueueSnapshot.mockResolvedValue([
      { movieId: 42, status: 'downloading' },
    ] as never);
    f.whis.getRootFolders.mockResolvedValue([]);
    f.whis.getQualityProfiles.mockResolvedValue([]);
    const options = await f.service.getRequestOptions('scene', 'resume');
    expect(options).toMatchObject({
      requiresSettings: false,
      plannedAction: 'ALREADY_QUEUED',
    });
    const result = await f.service.submitSceneRequest(
      'scene',
      { monitored: true, searchForMovie: true, tags: [] },
      'RE_REQUEST',
    );
    expect(result).toMatchObject({
      outcome: 'ALREADY_QUEUED',
      alreadyExists: true,
    });
    expect(f.dispatch).not.toHaveBeenCalled();
    expect(f.whis.createMovie).not.toHaveBeenCalled();
    expect(f.whis.searchMovie).not.toHaveBeenCalled();
    expect(f.operations.run).toHaveBeenCalledWith(
      'scene',
      expect.any(String),
      'RE_REQUEST',
      expect.any(Object),
      expect.any(Function),
    );
  });

  it.each([
    {
      queue: [
        {
          movieId: 42,
          trackedDownloadStatus: 'warning',
          errorMessage: 'Missing destination',
        },
      ],
      outcome: 'UPSTREAM_BLOCKED',
      message: 'Missing destination',
    },
    {
      queue: [
        {
          movieId: 42,
          status: 'completed',
          trackedDownloadState: 'importPending',
        },
      ],
      outcome: 'IMPORT_PENDING',
      message: 'awaiting import',
    },
    {
      queue: [{ movieId: 42, status: 'paused' }],
      outcome: 'UPSTREAM_BLOCKED',
      message: 'paused',
    },
  ])(
    'records an existing queue blocker or import condition without dispatch: $outcome',
    async ({ queue, outcome, message }) => {
      const f = fixture();
      f.whis.getQueueSnapshot.mockResolvedValue(queue as never);
      const result = await f.service.submitSceneRequest(
        'scene',
        settings,
        'RE_REQUEST',
      );
      expect(result).toMatchObject({
        outcome,
        message: expect.stringContaining(message),
      });
      expect(f.whis.createMovie).not.toHaveBeenCalled();
      expect(f.whis.searchMovie).not.toHaveBeenCalled();
      expect(f.dispatch).not.toHaveBeenCalled();
    },
  );

  it('records identification guidance rather than redownloading a file already imported', async () => {
    const f = fixture();
    f.whis.findMovieByStashId.mockResolvedValue({
      movieId: 42,
      stashId: 'scene',
      hasFile: true,
    });
    const result = await f.service.submitSceneRequest(
      'scene',
      settings,
      'RE_REQUEST',
    );
    expect(result.outcome).toBe('NEEDS_IDENTIFICATION');
    expect(f.whis.searchMovie).not.toHaveBeenCalled();
    expect(f.whis.createMovie).not.toHaveBeenCalled();
    expect(f.dispatch).not.toHaveBeenCalled();
  });

  it('does not send a new search when a transfer appears during the final check', async () => {
    const f = fixture();
    f.whis.getQueueSnapshot
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ movieId: 42, status: 'downloading' }] as never);
    const result = await f.service.submitSceneRequest(
      'scene',
      settings,
      'RE_REQUEST',
    );
    expect(result.outcome).toBe('ALREADY_QUEUED');
    expect(f.whis.searchMovie).not.toHaveBeenCalled();
    expect(f.dispatch).not.toHaveBeenCalled();
  });

  it('preserves existing settings and respects an explicit no-search resume', async () => {
    const f = fixture();
    const result = await f.service.submitSceneRequest(
      'scene',
      { ...settings, monitored: false, searchForMovie: false },
      'RE_REQUEST',
    );
    expect(result.outcome).toBe('ENTRY_REUSED');
    expect(f.whis.searchMovie).not.toHaveBeenCalled();
    expect(f.db.request.upsert.mock.calls[0][0].update).not.toHaveProperty(
      'settings',
    );
  });

  it('refuses an unverified resume during a queue outage', async () => {
    const f = fixture();
    f.whis.getQueueSnapshot.mockRejectedValue(new Error('offline'));
    await expect(
      f.service.submitSceneRequest('scene', settings, 'RE_REQUEST'),
    ).rejects.toThrow('offline');
    expect(f.whis.searchMovie).not.toHaveBeenCalled();
    expect(f.dispatch).not.toHaveBeenCalled();
  });

  it('rechecks missing-entry evidence after settings review so an externally created entry is reused', async () => {
    const f = fixture();
    f.whis.findMovieByStashId
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ movieId: 42, stashId: 'scene', hasFile: false });
    const result = await f.service.submitSceneRequest(
      'scene',
      settings,
      'RE_REQUEST',
    );
    expect(result.outcome).toBe('SEARCH_STARTED');
    expect(f.whis.createMovie).not.toHaveBeenCalled();
    expect(f.whis.searchMovie).toHaveBeenCalledTimes(1);
  });

  it('requires reviewed creation settings if a previously existing entry disappears', async () => {
    const f = fixture();
    f.whis.findMovieByStashId.mockResolvedValue(null);
    await expect(
      f.service.submitSceneRequest(
        'scene',
        { monitored: true, searchForMovie: true, tags: [] },
        'RE_REQUEST',
      ),
    ).rejects.toThrow('Review a destination library');
    expect(f.dispatch).not.toHaveBeenCalled();
    expect(f.whis.createMovie).not.toHaveBeenCalled();
  });

  it('previews and executes existing active re-requests consistently without settings or dedupe errors', async () => {
    const f = fixture();
    f.whis.getQueueSnapshot.mockResolvedValue([
      { movieId: 42, status: 'downloading' },
    ] as never);
    const dto = {
      kind: 'RE_REQUEST' as const,
      ids: ['scene'],
      operationKey: randomUUID(),
    };
    const preview = await f.service.previewBatch(dto);
    expect(preview.results[0]).toMatchObject({
      eligible: true,
      requiresSettings: false,
      plannedAction: 'ALREADY_QUEUED',
    });
    expect(f.dispatch).not.toHaveBeenCalled();
    const result = await f.service.executeBatch(dto);
    expect(result.results[0]).toMatchObject({
      ok: true,
      result: { outcome: 'ALREADY_QUEUED' },
    });
    expect(f.whis.createMovie).not.toHaveBeenCalled();
    expect(f.whis.searchMovie).not.toHaveBeenCalled();
  });

  it('does not consider an existing movie proof that an uncertain resume search was dispatched', async () => {
    const f = fixture();
    f.db.request.findUnique.mockResolvedValue({
      activeActionId: 'pending',
    } as never);
    f.db.requestAction.findUnique.mockResolvedValue({
      id: 'pending',
      state: 'UNCERTAIN',
      kind: 'RE_REQUEST',
      dispatchedAt: new Date(100_000),
      details: { operation: 'SEARCH_MOVIE', movieId: 42 },
    });
    await expect(f.service.checkOutcome('scene')).rejects.toThrow(
      'still unknown',
    );
    expect(f.operations.finish).not.toHaveBeenCalled();
    f.whis.getSearchCommands.mockResolvedValue([
      {
        id: 3,
        movieIds: [42],
        status: 'completed',
        queuedAt: new Date(101_000).toISOString(),
      },
    ]);
    expect(await f.service.checkOutcome('scene')).toMatchObject({
      outcome: 'SEARCH_CONFIRMED',
      commandId: 3,
    });
    expect(f.whis.searchMovie).not.toHaveBeenCalled();
  });
});
