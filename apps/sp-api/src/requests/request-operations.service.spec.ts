import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RequestOperationsService } from './request-operations.service';

// Transactional memory double. A separate PostgreSQL check exercises the actual
// migration and concurrent conditional-claim SQL against a disposable database.
function database() {
  const rows = new Map<string, Record<string, unknown>>();
  const actions = new Map<string, Record<string, unknown>>();
  const tx = {
    request: {
      upsert: async ({ where }: { where: { stashId: string } }) => {
        if (!rows.has(where.stashId))
          rows.set(where.stashId, {
            stashId: where.stashId,
            activeActionId: null,
          });
        return rows.get(where.stashId);
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { stashId: string; activeActionId: string | null };
        data: object;
      }) => {
        const row = rows.get(where.stashId);
        if (row?.activeActionId !== where.activeActionId) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      update: async ({
        where,
        data,
      }: {
        where: { stashId: string };
        data: object;
      }) => Object.assign(rows.get(where.stashId)!, data),
      findUnique: async ({ where }: { where: { stashId: string } }) =>
        rows.get(where.stashId) ?? null,
    },
    requestAction: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        actions.get(where.id) ?? null,
      create: async ({ data }: { data: { id: string } }) => {
        if (actions.has(data.id)) throw new Error('duplicate action');
        const action = {
          ...data,
          state: 'RUNNING',
          dispatchedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        actions.set(data.id, action);
        return action;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: {
          id: string;
          state: string;
          dispatchedAt?: null;
          updatedAt?: { lte: Date };
        };
        data: object;
      }) => {
        const action = actions.get(where.id);
        if (action?.state !== where.state) return { count: 0 };
        if (
          'dispatchedAt' in where &&
          action.dispatchedAt !== where.dispatchedAt
        )
          return { count: 0 };
        if (where.updatedAt && (action.updatedAt as Date) > where.updatedAt.lte)
          return { count: 0 };
        Object.assign(action, data);
        return { count: 1 };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: object;
      }) => Object.assign(actions.get(where.id)!, data),
    },
  };
  let barrier: Promise<unknown> = Promise.resolve();
  const prisma = {
    ...tx,
    $transaction: <T>(work: (client: typeof tx) => Promise<T>) => {
      const result = barrier.then(() => work(tx));
      barrier = result.catch(() => undefined);
      return result;
    },
  } as unknown as PrismaService;
  return { prisma, rows, actions };
}

describe('RequestOperationsService', () => {
  it('returns a recorded success without dispatching a repeated key', async () => {
    const db = database();
    const service = new RequestOperationsService(db.prisma);
    const work = jest.fn(async () => ({ outcome: 'CREATED' }));
    await service.run('scene', 'key', 'REQUEST', { profile: 1 }, work);
    expect(
      await service.run('scene', 'key', 'REQUEST', { profile: 1 }, work),
    ).toEqual({ outcome: 'CREATED' });
    expect(work).toHaveBeenCalledTimes(1);
    expect(db.rows.get('scene')?.activeActionId).toBeNull();
  });

  it('rejects reusing a key for different settings or a different scene', async () => {
    const db = database();
    const service = new RequestOperationsService(db.prisma);
    await service.run(
      'scene',
      'key',
      'REQUEST',
      { profile: 1 },
      async () => ({}),
    );
    await expect(
      service.run('scene', 'key', 'REQUEST', { profile: 2 }, async () => ({})),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.run('other', 'key', 'REQUEST', { profile: 1 }, async () => ({})),
    ).rejects.toThrow(ConflictException);
  });

  it('serializes concurrent actions on a scene, including from another service instance', async () => {
    const db = database();
    const first = new RequestOperationsService(db.prisma);
    const second = new RequestOperationsService(db.prisma);
    let release!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const work = jest.fn(async (dispatch: () => Promise<void>) => {
      started();
      await gate;
      await dispatch();
      return {};
    });
    const pending = first.run('scene', 'one', 'REQUEST', {}, work);
    await ready;
    await expect(
      second.run('scene', 'two', 'SEARCH', {}, work),
    ).rejects.toThrow('Another action');
    release();
    await pending;
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('retains an uncertain dispatch across a simulated restart and blocks blind retries', async () => {
    const db = database();
    const service = new RequestOperationsService(db.prisma);
    const work = jest.fn(async (dispatch: () => Promise<void>) => {
      await dispatch();
      throw new Error('response timeout');
    });
    await expect(
      service.run('scene', 'one', 'REQUEST', {}, work),
    ).rejects.toThrow('may have reached');
    expect(db.actions.get('one')?.state).toBe('UNCERTAIN');
    expect(db.rows.get('scene')?.activeActionId).toBe('one');
    const restarted = new RequestOperationsService(db.prisma);
    await expect(
      restarted.run('scene', 'two', 'REQUEST', {}, work),
    ).rejects.toThrow('Another action');
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('releases a failure known to have occurred before dispatch', async () => {
    const db = database();
    const service = new RequestOperationsService(db.prisma);
    await expect(
      service.run('scene', 'one', 'REQUEST', {}, async () => {
        throw new ConflictException('Folder unavailable');
      }),
    ).rejects.toMatchObject({ response: { actionState: 'FAILED' } });
    expect(db.actions.get('one')?.state).toBe('FAILED');
    expect(db.rows.get('scene')?.activeActionId).toBeNull();
    await expect(
      service.run('scene', 'two', 'REQUEST', {}, async () => ({ ok: true })),
    ).resolves.toEqual({ ok: true });
  });

  it('does not let a recovered pre-dispatch action send later', async () => {
    const db = database();
    const service = new RequestOperationsService(db.prisma);
    await expect(
      service.run('scene', 'one', 'REQUEST', {}, async (dispatch) => {
        await service.finish('scene', 'one', 'FAILED', { outcome: 'NOT_SENT' });
        await dispatch();
        return {};
      }),
    ).rejects.toThrow('no longer active');
    expect(db.actions.get('one')?.dispatchedAt).toBeNull();
  });

  it('keeps the claim when persistence fails after a remote success', async () => {
    const db = database();
    const service = new RequestOperationsService(db.prisma);
    jest
      .spyOn(service, 'finish')
      .mockRejectedValueOnce(new Error('commit response lost'));
    await expect(
      service.run('scene', 'one', 'REQUEST', {}, async (dispatch) => {
        await dispatch();
        return { ok: true };
      }),
    ).rejects.toThrow('may have reached');
    expect(db.rows.get('scene')?.activeActionId).toBe('one');
    expect(db.actions.get('one')?.state).toBe('UNCERTAIN');
  });

  it('recovers only an old unsent action and prevents its original worker sending later', async () => {
    const db = database();
    const service = new RequestOperationsService(db.prisma);
    await expect(
      service.run('scene', 'one', 'REQUEST', {}, async (dispatch) => {
        db.actions.get('one')!.updatedAt = new Date(0);
        await service.recoverUnsent('scene', 'one');
        await dispatch();
        return {};
      }),
    ).rejects.toThrow('no longer active');
    expect(db.rows.get('scene')?.activeActionId).toBeNull();
    expect(db.actions.get('one')?.dispatchedAt).toBeNull();
  });

  it('does not recover an action that another worker has already marked dispatched', async () => {
    const db = database();
    const service = new RequestOperationsService(db.prisma);
    await service.run('scene', 'one', 'REQUEST', {}, async (dispatch) => {
      await dispatch();
      db.actions.get('one')!.updatedAt = new Date(0);
      await expect(service.recoverUnsent('scene', 'one')).rejects.toThrow(
        'may have been sent',
      );
      expect(db.rows.get('scene')?.activeActionId).toBe('one');
      return {};
    });
  });
});
