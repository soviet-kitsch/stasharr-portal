import { SceneIndex } from '@prisma/client';
import {
  ACQUISITION_SNAPSHOT_JOBS,
  AcquisitionEvidence,
  reconcileAcquisition,
} from './acquisition-reconciliation';

describe('acquisition reconciliation', () => {
  const now = new Date('2026-10-27T13:00:00Z');
  const oldRequest = new Date('2026-10-26T12:00:00Z');
  const freshEvidence = (): AcquisitionEvidence => ({
    sourcesReady: true,
    states: Object.values(ACQUISITION_SNAPSHOT_JOBS).map((jobName) => ({
      jobName,
      status: 'SUCCEEDED',
      startedAt: new Date('2026-10-27T12:59:00Z'),
      lastSuccessAt: new Date('2026-10-27T12:59:30Z'),
    })),
  });
  const row = (overrides: Partial<SceneIndex> = {}) =>
    ({
      computedLifecycle: 'REQUESTED',
      requestStatus: 'REQUESTED',
      requestUpdatedAt: oldRequest,
      whisparrMovieId: null,
      whisparrHasFile: null,
      whisparrQueueStatus: null,
      whisparrErrorMessage: null,
      ...overrides,
    }) as SceneIndex;

  it('distinguishes an orphan from an ordinary request awaiting a release', () => {
    expect(reconcileAcquisition(row(), freshEvidence(), now)).toMatchObject({
      condition: 'ORPHANED_REQUEST',
      needsAttention: true,
    });
    expect(
      reconcileAcquisition(
        row({ whisparrMovieId: 1, whisparrHasFile: false }),
        freshEvidence(),
        now,
      ),
    ).toMatchObject({
      condition: 'WAITING_FOR_RELEASE',
      needsAttention: false,
    });
  });

  it.each(['movies', 'queue', 'stash'] as const)(
    'does not infer absence from failed, missing, future or stale %s evidence',
    (source) => {
      for (const mode of ['failed', 'missing', 'future', 'stale']) {
        const evidence = freshEvidence();
        const state = evidence.states.find(
          (state) => state.jobName === ACQUISITION_SNAPSHOT_JOBS[source],
        )!;
        if (mode === 'failed') state.status = 'FAILED';
        if (mode === 'missing')
          evidence.states = evidence.states.filter((item) => item !== state);
        if (mode === 'future')
          state.lastSuccessAt = new Date(now.getTime() + 1);
        if (mode === 'stale') state.lastSuccessAt = oldRequest;
        expect(reconcileAcquisition(row(), evidence, now).condition).toBe(
          'STATUS_UNAVAILABLE',
        );
      }
    },
  );

  it('does not mistake a recent metadata write for a fresh movie snapshot', () => {
    const evidence = freshEvidence();
    evidence.states.find(
      (state) => state.jobName === ACQUISITION_SNAPSHOT_JOBS.movies,
    )!.lastSuccessAt = oldRequest;
    expect(
      reconcileAcquisition(
        row({ lastSyncedAt: now, metadataLastSyncedAt: now }),
        evidence,
        now,
      ).condition,
    ).toBe('STATUS_UNAVAILABLE');
  });

  it('requires configured integrations even when cached snapshots are fresh', () => {
    expect(
      reconcileAcquisition(
        row(),
        { ...freshEvidence(), sourcesReady: false },
        now,
      ).condition,
    ).toBe('STATUS_UNAVAILABLE');
  });

  it.each([
    new Date('2026-10-27T12:59:45Z'),
    new Date('2026-10-27T12:58:00Z'),
    null,
  ])(
    'waits for post-submission snapshots and a grace period (%s)',
    (requestUpdatedAt) => {
      expect(
        reconcileAcquisition(row({ requestUpdatedAt }), freshEvidence(), now)
          .condition,
      ).toBe('VERIFYING_REQUEST');
    },
  );

  it('does not use an in-flight full snapshot to prove absence', () => {
    const evidence = freshEvidence();
    evidence.states[0].status = 'RUNNING';
    expect(reconcileAcquisition(row(), evidence, now).condition).toBe(
      'VERIFYING_REQUEST',
    );
  });

  it('prefers confirmed available state over orphan or queue evidence', () => {
    expect(
      reconcileAcquisition(
        row({ computedLifecycle: 'AVAILABLE' }),
        freshEvidence(),
        now,
      ).condition,
    ).toBe('AVAILABLE');
  });

  it('keeps imported files awaiting a catalog match instead of marking them available or redownloading', () => {
    const input = row({
      computedLifecycle: 'IMPORT_PENDING',
      whisparrMovieId: 1,
      whisparrHasFile: true,
    });
    expect(reconcileAcquisition(input, freshEvidence(), now)).toMatchObject({
      condition: 'WAITING_FOR_STASH_MATCH',
      needsAttention: true,
    });
    expect(input.computedLifecycle).toBe('IMPORT_PENDING');
  });

  it('does not claim Whisparr has imported a merely completed download', () => {
    expect(
      reconcileAcquisition(
        row({
          computedLifecycle: 'IMPORT_PENDING',
          whisparrMovieId: 1,
          whisparrHasFile: false,
        }),
        freshEvidence(),
        now,
      ).condition,
    ).toBe('WHISPARR_IMPORT_PENDING');
  });

  it.each([
    ['FAILED', 'failed', 'WHISPARR_BLOCKED'],
    ['DOWNLOADING', 'downloading', 'DOWNLOADING'],
    ['REQUESTED', 'queued', 'QUEUED'],
  ])(
    'explains %s upstream conditions',
    (computedLifecycle, whisparrQueueStatus, expected) => {
      expect(
        reconcileAcquisition(
          row({
            computedLifecycle:
              computedLifecycle as SceneIndex['computedLifecycle'],
            whisparrMovieId: 1,
            whisparrQueueStatus,
          }),
          freshEvidence(),
          now,
        ).condition,
      ).toBe(expected);
    },
  );

  it('shows the oldest complete source check rather than a newer unrelated write', () => {
    const evidence = freshEvidence();
    evidence.states[0].lastSuccessAt = new Date('2026-10-27T12:50:00Z');
    evidence.states[0].startedAt = new Date('2026-10-27T12:49:59Z');
    expect(reconcileAcquisition(row(), evidence, now).checkedAt).toBe(
      '2026-10-27T12:50:00.000Z',
    );
  });
});
