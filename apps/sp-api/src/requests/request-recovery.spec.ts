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
  return { service, index, whis, stash, metadata, db, dispatch, operations };
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

  it('reuses an existing Whisparr entry without creating a duplicate or starting another search', async () => {
    const f = fixture();
    expect(
      await f.service.submitSceneRequest('scene', settings, 'RE_REQUEST'),
    ).toMatchObject({ alreadyExists: true, whisparrMovieId: 42 });
    expect(f.whis.createMovie).not.toHaveBeenCalled();
    expect(f.whis.searchMovie).not.toHaveBeenCalled();
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

  it('requires explicit settings for a legacy request and restores valid saved settings', async () => {
    const f = fixture();
    f.db.request.findUnique.mockResolvedValue({ settings: null } as never);
    const legacy = await f.service.getRequestOptions('scene');
    expect(legacy.defaults.rootFolderPath).toBeNull();
    expect(legacy.defaults.qualityProfileId).toBeNull();
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
});
