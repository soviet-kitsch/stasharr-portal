import { RequestEntryDeletionService } from './request-entry-deletion.service';
import {
  RequestDeletionService,
  canonicalDeletionPath,
} from './request-deletion.service';
import { RequestOperationsService } from './request-operations.service';
const id = '01a0d367-a37a-779d-9d6c-3c634b17f211';
const key = '08a0d367-a37a-779d-9d6c-3c634b17f211';
const scene = {
  id: 42,
  stashId: id,
  title: 'Synthetic scene',
  path: '/media/library/scene',
  hasFile: true,
  added: '2026-10-30',
};
const file = {
  id: 7,
  movieId: 42,
  path: '/media/library/scene/video.mp4',
  size: 123,
  dateAdded: '2026-10-30',
};
function setup() {
  const row: any = { stashId: id, activeActionId: null };
  const actions = new Map<string, any>();
  const prisma: any = {
    request: {
      findUnique: jest.fn(async () => ({ ...row })),
      upsert: jest.fn(async () => row),
      updateMany: jest.fn(async ({ where, data }) => {
        if (where.activeActionId === null && row.activeActionId)
          return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
      update: jest.fn(async ({ data }) => Object.assign(row, data)),
    },
    requestAction: {
      findUnique: jest.fn(async ({ where }) => actions.get(where.id) ?? null),
      create: jest.fn(async ({ data }) => {
        const action = {
          ...data,
          state: 'RUNNING',
          updatedAt: new Date(),
          dispatchedAt: null,
        };
        actions.set(data.id, action);
        return action;
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        const action = actions.get(where.id);
        if (!action || action.state !== where.state) return { count: 0 };
        Object.assign(action, data);
        return { count: 1 };
      }),
      update: jest.fn(async ({ where, data }) =>
        Object.assign(actions.get(where.id), data),
      ),
    },
  };
  prisma.$transaction = (work) => work(prisma);
  let removed = false;
  const native: any = {
    scenes: jest.fn(async () => (removed ? [] : [{ ...scene }])),
    roots: jest.fn(async () => [{ path: '/media/library', accessible: true }]),
    files: jest.fn(async () => [{ ...file }]),
    assertIdle: jest.fn(async () => undefined),
    deleteSceneEntry: jest.fn(async () => {
      removed = true;
    }),
    deleteSceneAndFiles: jest.fn(async () => {
      removed = true;
    }),
    sceneById: jest.fn(async () => (removed ? null : scene)),
  };
  const config = {
    id: 1,
    enabled: true,
    status: 'CONFIGURED',
    baseUrl: 'http://whisparr:6969',
    apiKey: 'synthetic',
  };
  const integrations: any = { findOne: jest.fn(async () => config) };
  const catalog: any = {
    getConfiguredCatalogProvider: jest.fn(async () => ({
      providerKey: 'STASHDB',
      baseUrl: 'https://catalog.invalid',
    })),
  };
  const indexing: any = { refreshRequestRow: jest.fn(async () => undefined) };
  const service = new RequestDeletionService(
    prisma,
    integrations,
    catalog,
    native,
    { buildSceneViewUrl: (base, id) => base + '/movie/' + id } as any,
    new RequestOperationsService(prisma),
    indexing,
  );
  return {
    service,
    entryService: new RequestEntryDeletionService(
      prisma,
      integrations,
      catalog,
      native,
      { buildSceneViewUrl: (base, id) => base + '/movie/' + id } as any,
      new RequestOperationsService(prisma),
      indexing,
    ),
    native,
    prisma,
    actions,
    row,
    config,
    catalog,
    integrations,
    indexing,
    markRemoved: () => {
      removed = true;
    },
  };
}
describe('reviewed Whisparr request deletion', () => {
  it('previews without mutating, then dispatches once and replays the persisted result', async () => {
    const f = setup();
    const preview = await f.service.preview(id);
    expect(preview.folder).toBe(scene.path);
    expect(preview.files).toEqual([file]);
    expect(f.native.deleteSceneAndFiles).not.toHaveBeenCalled();
    const dto = {
      operationKey: key,
      previewToken: preview.previewToken,
      confirmDeleteFiles: true,
    };
    const result = await f.service.remove(id, dto);
    expect(result.fileCleanup).toBe('REQUESTED_NOT_VERIFIED');
    expect(f.native.deleteSceneAndFiles).toHaveBeenCalledWith(
      42,
      expect.anything(),
    );
    expect(f.row.dismissedAt).toBeInstanceOf(Date);
    expect(f.row.activeActionId).toBeNull();
    expect(await f.service.remove(id, dto)).toEqual(result);
    expect(f.native.deleteSceneAndFiles).toHaveBeenCalledTimes(1);
  });
  it.each([
    'missing confirmation',
    'tampered preview',
    'expired preview',
    'changed connection',
    'changed files',
  ])('blocks %s before dispatch', async (reason) => {
    const f = setup();
    const preview = await f.service.preview(id);
    const dto = {
      operationKey: key,
      previewToken: preview.previewToken,
      confirmDeleteFiles: true,
    };
    if (reason === 'missing confirmation') dto.confirmDeleteFiles = false;
    if (reason === 'tampered preview') dto.previewToken += 'x';
    if (reason === 'expired preview')
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 360000);
    if (reason === 'changed connection')
      f.config.baseUrl = 'http://other.invalid';
    if (reason === 'changed files')
      f.native.files.mockResolvedValue([{ ...file, size: 999 }]);
    try {
      await expect(f.service.remove(id, dto)).rejects.toThrow();
    } finally {
      jest.restoreAllMocks();
    }
    expect(f.native.deleteSceneAndFiles).not.toHaveBeenCalled();
    expect(f.row.dismissedAt).toBeUndefined();
  });
  it.each([
    'no exact match',
    'ambiguous match',
    'shared folder',
    'nested folder',
    'outside root',
    'outside file',
    'busy transfer',
  ])('blocks %s', async (reason) => {
    const f = setup();
    if (reason === 'no exact match')
      f.native.scenes.mockResolvedValue([{ ...scene, stashId: null }]);
    if (reason === 'ambiguous match')
      f.native.scenes.mockResolvedValue([scene, { ...scene, id: 43 }]);
    if (reason === 'shared folder')
      f.native.scenes.mockResolvedValue([
        scene,
        { ...scene, id: 43, stashId: 'other' },
      ]);
    if (reason === 'nested folder')
      f.native.scenes.mockResolvedValue([
        scene,
        { ...scene, id: 43, stashId: 'other', path: scene.path + '/nested' },
      ]);
    if (reason === 'outside root')
      f.native.roots.mockResolvedValue([{ path: '/other', accessible: true }]);
    if (reason === 'outside file')
      f.native.files.mockResolvedValue([{ ...file, path: '/other/video.mp4' }]);
    if (reason === 'busy transfer')
      f.native.assertIdle.mockRejectedValue(new Error('busy'));
    await expect(f.service.preview(id)).rejects.toThrow();
    expect(f.native.deleteSceneAndFiles).not.toHaveBeenCalled();
  });
  it('retains an uncertain claim after a timeout, never resends, and recovers by reads only', async () => {
    const f = setup();
    const preview = await f.service.preview(id);
    f.native.deleteSceneAndFiles.mockRejectedValue(new Error('timeout'));
    const dto = {
      operationKey: key,
      previewToken: preview.previewToken,
      confirmDeleteFiles: true,
    };
    await expect(f.service.remove(id, dto)).rejects.toThrow('may have reached');
    expect(f.actions.get(key).state).toBe('UNCERTAIN');
    expect(f.row.activeActionId).toBe(key);
    await expect(f.service.remove(id, dto)).rejects.toThrow();
    await expect(f.service.recoverIfNeeded(id)).rejects.toThrow(
      'not yet confirmed',
    );
    f.markRemoved();
    const result = await f.service.recoverIfNeeded(id);
    expect(result?.fileCleanup).toBe('OUTCOME_UNKNOWN');
    expect(f.native.deleteSceneAndFiles).toHaveBeenCalledTimes(1);
    expect(f.row.activeActionId).toBeNull();
  });
  it('does not mistake a single 404 for confirmed removal', async () => {
    const f = setup();
    const preview = await f.service.preview(id);
    f.native.deleteSceneAndFiles.mockResolvedValue(undefined);
    f.native.sceneById.mockResolvedValue(null);
    await expect(
      f.service.remove(id, {
        operationKey: key,
        previewToken: preview.previewToken,
        confirmDeleteFiles: true,
      }),
    ).rejects.toThrow('may have reached');
    expect(f.row.dismissedAt).toBeUndefined();
  });
  it('blocks a second action while a deletion is unresolved', async () => {
    const f = setup();
    f.row.activeActionId = key;
    await expect(f.service.preview(id)).rejects.toThrow('Another action');
    expect(f.native.scenes).not.toHaveBeenCalled();
  });
  it.each(['/media/../other', 'relative/path', '/media/scene\u0000'])(
    'rejects unsafe path %s',
    (path) => {
      expect(() => canonicalDeletionPath(path)).toThrow();
    },
  );
});

describe('reviewed entry-only cleanup from Stash search', () => {
  const dto = (preview: { previewToken: string }) => ({
    operationKey: key,
    previewToken: preview.previewToken,
    confirmDeleteEntry: true,
  });
  it('removes exactly one reviewed entry, keeps files and replays without another native DELETE', async () => {
    const f = setup();
    const preview = await f.entryService.preview(id);
    expect(preview.whisparrSceneId).toBe(42);
    expect(preview.filesKept).toBe(true);
    expect(f.native.deleteSceneEntry).not.toHaveBeenCalled();
    const result = await f.entryService.remove(id, dto(preview));
    expect(result).toMatchObject({
      outcome: 'WHISPARR_ENTRY_CLEANED',
      whisparrSceneId: 42,
      filesKept: true,
    });
    expect(f.native.deleteSceneEntry).toHaveBeenCalledWith(
      42,
      expect.anything(),
    );
    expect(f.native.deleteSceneAndFiles).not.toHaveBeenCalled();
    expect(await f.entryService.remove(id, dto(preview))).toEqual(result);
    expect(f.native.deleteSceneEntry).toHaveBeenCalledTimes(1);
    expect(f.row.dismissedAt).toBeInstanceOf(Date);
  });
  it('removes only the Portal request after verifying that no exact Whisparr entry exists', async () => {
    const f = setup();
    f.markRemoved();
    const preview = await f.entryService.preview(id);
    expect(preview.whisparrSceneId).toBeNull();
    const result = await f.entryService.remove(id, dto(preview));
    expect(result.whisparrSceneId).toBeNull();
    expect(f.native.deleteSceneEntry).not.toHaveBeenCalled();
    expect(f.native.deleteSceneAndFiles).not.toHaveBeenCalled();
    expect(f.row.dismissedAt).toBeInstanceOf(Date);
  });
  it.each(['busy', 'duplicate', 'offline', 'active claim', 'wrong provider'])(
    'blocks %s during review without dismissing the request',
    async (reason) => {
      const f = setup();
      if (reason === 'busy')
        f.native.assertIdle.mockRejectedValue(new Error('busy'));
      if (reason === 'duplicate')
        f.native.scenes.mockResolvedValue([scene, { ...scene, id: 43 }]);
      if (reason === 'offline')
        f.native.scenes.mockRejectedValue(new Error('offline'));
      if (reason === 'active claim') f.row.activeActionId = key;
      if (reason === 'wrong provider')
        f.catalog.getConfiguredCatalogProvider.mockResolvedValue({
          providerKey: 'OTHER',
          baseUrl: 'https://other.invalid',
        });
      await expect(f.entryService.preview(id)).rejects.toThrow();
      expect(f.row.dismissedAt).toBeUndefined();
      expect(f.native.deleteSceneEntry).not.toHaveBeenCalled();
    },
  );
  it.each([
    'missing confirmation',
    'tampered',
    'expired',
    'connection changed',
    'entry changed',
    'entry added',
    'entry vanished',
    'became busy',
  ])('blocks %s between review and dispatch', async (reason) => {
    const f = setup();
    if (reason === 'entry added') f.native.scenes.mockResolvedValue([]);
    const preview = await f.entryService.preview(id);
    const body = dto(preview);
    if (reason === 'missing confirmation') body.confirmDeleteEntry = false;
    if (reason === 'tampered') body.previewToken += 'x';
    if (reason === 'expired')
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 360000);
    if (reason === 'connection changed')
      f.config.baseUrl = 'http://changed.invalid';
    if (reason === 'entry changed')
      f.native.scenes.mockResolvedValue([{ ...scene, id: 43 }]);
    if (reason === 'entry added') f.native.scenes.mockResolvedValue([scene]);
    if (reason === 'entry vanished') f.markRemoved();
    if (reason === 'became busy')
      f.native.assertIdle.mockRejectedValue(new Error('busy'));
    try {
      await expect(f.entryService.remove(id, body)).rejects.toThrow();
    } finally {
      jest.restoreAllMocks();
    }
    expect(f.native.deleteSceneEntry).not.toHaveBeenCalled();
    expect(f.row.dismissedAt).toBeUndefined();
  });
  it('does not accept a file-deletion preview for entry-only cleanup or vice versa', async () => {
    const f = setup();
    const files = await f.service.preview(id),
      entry = await f.entryService.preview(id);
    await expect(f.entryService.remove(id, dto(files))).rejects.toThrow(
      'invalid',
    );
    await expect(
      f.service.remove(id, { ...dto(entry), confirmDeleteFiles: true }),
    ).rejects.toThrow('invalid');
    expect(f.native.deleteSceneEntry).not.toHaveBeenCalled();
    expect(f.native.deleteSceneAndFiles).not.toHaveBeenCalled();
  });
  it('keeps uncertain operations claimed, never resends, and recovers by verifying absence', async () => {
    const f = setup();
    const preview = await f.entryService.preview(id);
    f.native.deleteSceneEntry.mockRejectedValue(new Error('timeout'));
    await expect(f.entryService.remove(id, dto(preview))).rejects.toThrow(
      'may have reached',
    );
    expect(f.row.dismissedAt).toBeUndefined();
    expect(f.row.activeActionId).toBe(key);
    await expect(f.entryService.remove(id, dto(preview))).rejects.toThrow();
    await expect(f.entryService.recoverIfNeeded(id)).rejects.toThrow(
      'not yet confirmed',
    );
    f.markRemoved();
    const result = await f.entryService.recoverIfNeeded(id);
    expect(result).toMatchObject({
      filesKept: true,
      outcome: 'WHISPARR_ENTRY_CLEANED',
    });
    expect(f.native.deleteSceneEntry).toHaveBeenCalledTimes(1);
    expect(f.row.activeActionId).toBeNull();
  });
  it('requires complete absence evidence, not just a single 404', async () => {
    const f = setup();
    const preview = await f.entryService.preview(id);
    f.native.deleteSceneEntry.mockResolvedValue(undefined);
    f.native.sceneById.mockResolvedValue(null);
    await expect(f.entryService.remove(id, dto(preview))).rejects.toThrow(
      'may have reached',
    );
    expect(f.row.dismissedAt).toBeUndefined();
  });
});
