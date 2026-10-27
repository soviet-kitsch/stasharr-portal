import { SceneIndex, SyncState } from '@prisma/client';

export const ACQUISITION_SNAPSHOT_JOBS = {
  movies: 'scene-index-whisparr-movies',
  queue: 'scene-index-whisparr-queue',
  stash: 'scene-index-library-projection',
} as const;

export interface AcquisitionEvidence {
  sourcesReady: boolean;
  states: Pick<
    SyncState,
    'jobName' | 'status' | 'startedAt' | 'lastSuccessAt'
  >[];
}

export interface AcquisitionReconciliation {
  condition: string;
  label: string;
  message: string;
  needsAttention: boolean;
  checkedAt: string | null;
}

type ReconciliationRow = Pick<
  SceneIndex,
  | 'computedLifecycle'
  | 'requestStatus'
  | 'requestUpdatedAt'
  | 'whisparrMovieId'
  | 'whisparrHasFile'
  | 'whisparrQueueStatus'
  | 'whisparrErrorMessage'
>;

// These budgets follow the existing 15-minute movie, 30-second queue and
// five-minute library jobs. A metadata write must never refresh this evidence.
const MAX_AGE_MS = {
  movies: 20 * 60_000,
  queue: 2 * 60_000,
  stash: 10 * 60_000,
};
const SUBMISSION_GRACE_MS = 2 * 60_000;

export function reconcileAcquisition(
  row: ReconciliationRow,
  evidence: AcquisitionEvidence,
  now = new Date(),
): AcquisitionReconciliation {
  const snapshots = Object.entries(ACQUISITION_SNAPSHOT_JOBS).map(
    ([source, jobName]) => ({
      source: source as keyof typeof MAX_AGE_MS,
      state: evidence.states.find((state) => state.jobName === jobName),
    }),
  );
  const successfulTimes = snapshots.map(({ state }) =>
    state?.lastSuccessAt?.getTime(),
  );
  const checkedAt = successfulTimes.every(
    (time) => time !== undefined && Number.isFinite(time),
  )
    ? new Date(Math.min(...(successfulTimes as number[]))).toISOString()
    : null;
  const result = (
    condition: string,
    label: string,
    message: string,
    needsAttention = false,
  ): AcquisitionReconciliation => ({
    condition,
    label,
    message,
    needsAttention,
    checkedAt,
  });

  const unavailable = snapshots.filter(({ source, state }) => {
    const time = state?.lastSuccessAt?.getTime();
    return (
      !state ||
      (state.status !== 'SUCCEEDED' && state.status !== 'RUNNING') ||
      time === undefined ||
      !Number.isFinite(time) ||
      time > now.getTime() ||
      now.getTime() - time > MAX_AGE_MS[source]
    );
  });
  if (!evidence.sourcesReady || unavailable.length) {
    return result(
      'STATUS_UNAVAILABLE',
      'Status needs refresh',
      'A required connection or complete snapshot is unavailable or out of date. The previous lifecycle is retained; absence is not confirmed.',
      true,
    );
  }

  if (row.computedLifecycle === 'AVAILABLE') {
    return result(
      'AVAILABLE',
      'Available in Stash',
      'A matching catalog link is present in the current Stash projection.',
    );
  }

  if (row.whisparrMovieId === null) {
    if (row.requestStatus === null) {
      return result(
        'NOT_TRACKED',
        'Not tracked',
        'No request or Whisparr entry is recorded.',
      );
    }
    // A request can be created while a snapshot is in flight. Only a completed
    // movie AND library snapshot that started after the grace period proves absence.
    const absenceProven = snapshots
      .filter(({ source }) => source !== 'queue')
      .every(
        ({ state }) =>
          state?.status === 'SUCCEEDED' &&
          state.startedAt !== null &&
          state.lastSuccessAt !== null &&
          state.startedAt.getTime() <= state.lastSuccessAt.getTime() &&
          row.requestUpdatedAt !== null &&
          state.startedAt.getTime() >=
            row.requestUpdatedAt.getTime() + SUBMISSION_GRACE_MS,
      );
    if (!absenceProven) {
      return result(
        'VERIFYING_REQUEST',
        'Verifying request',
        'Waiting for complete snapshots taken after submission before deciding whether the request is orphaned.',
      );
    }
    return result(
      'ORPHANED_REQUEST',
      'Missing in Whisparr',
      'The request remains in Portal, but complete refreshes found no Whisparr entry or matching Stash catalog link. Review it before resubmitting.',
      true,
    );
  }

  if (row.computedLifecycle === 'FAILED') {
    return result(
      'WHISPARR_BLOCKED',
      'Needs attention in Whisparr',
      row.whisparrErrorMessage?.trim() ||
        'Whisparr reports a blocked or paused download. Inspect the upstream queue before retrying.',
      true,
    );
  }
  if (row.whisparrHasFile === true) {
    return result(
      'WAITING_FOR_STASH_MATCH',
      'Waiting for Stash match',
      'Whisparr reports an imported file, but Stash has no matching catalog link. Check identification or a different catalog record before downloading again.',
      true,
    );
  }
  if (row.computedLifecycle === 'IMPORT_PENDING') {
    return result(
      'WHISPARR_IMPORT_PENDING',
      'Whisparr import pending',
      'The download is awaiting import in Whisparr; an imported file has not yet been confirmed.',
    );
  }
  if (row.computedLifecycle === 'DOWNLOADING') {
    return result(
      'DOWNLOADING',
      'Downloading',
      'Whisparr reports an active download.',
    );
  }
  if (row.whisparrQueueStatus?.trim().toLowerCase() === 'queued') {
    return result(
      'QUEUED',
      'Queued in Whisparr',
      'Whisparr has queued this download.',
    );
  }
  return result(
    'WAITING_FOR_RELEASE',
    'Waiting for release',
    'Whisparr has the entry, with no active download or imported file. Check monitoring and release availability there.',
  );
}
