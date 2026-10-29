import { createHash } from 'node:crypto';

export function evidenceId(...values: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

export function safeText(value: unknown, max = 500): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/https?:\/\/\S+|magnet:\S+/gi, '[link omitted]')
    .replace(
      /\b(api[-_]?key|token|passkey|password|authorization|cookie)\s*[:=]\s*\S+/gi,
      '$1=[redacted]',
    )
    .replace(/[\u0000-\u001f]/g, ' ')
    .slice(0, max);
}

export interface Candidate {
  rank: number;
  title: string;
  indexer: string;
  quality: string;
  size: number | null;
  seeders: number | null;
  mappedMovieId: number | null;
  approved: boolean;
  rejections: string[];
  protocol: string;
  score: number | null;
}

export function parseDecisions(payload: unknown) {
  if (
    !Array.isArray(payload) ||
    payload.some(
      (r) =>
        !r ||
        typeof r.title !== 'string' ||
        typeof r.approved !== 'boolean' ||
        !Array.isArray(r.rejections) ||
        !r.rejections.every((s: unknown) => typeof s === 'string'),
    )
  ) {
    throw new Error('Incomplete release decisions');
  }
  const candidates: Candidate[] = payload.slice(0, 200).map((r, i) => ({
    rank: i + 1,
    title: safeText(r.title),
    indexer: safeText(r.indexer, 120),
    quality: safeText(r.quality?.quality?.name, 80),
    size: Number.isSafeInteger(r.size) && r.size >= 0 ? r.size : null,
    seeders:
      Number.isSafeInteger(r.seeders) && r.seeders >= 0 ? r.seeders : null,
    mappedMovieId: Number.isSafeInteger(r.mappedMovieId)
      ? r.mappedMovieId
      : null,
    approved: r.approved,
    rejections: r.rejections.map((s: string) => safeText(s)),
    protocol: safeText(r.protocol, 30),
    score: Number.isFinite(r.customFormatScore) ? r.customFormatScore : null,
  }));
  return {
    candidates,
    candidateCount: payload.length,
    rejectedCount: payload.filter(
      (r) => r.rejected === true || r.rejections.length > 0,
    ).length,
    outcome: !payload.length
      ? 'NO_CANDIDATES'
      : payload.every((r) => !r.approved && r.rejections.length)
        ? 'ALL_REJECTED'
        : 'CANDIDATES',
  };
}

export function shortStatus(
  condition: string,
  attempt?: {
    state: string;
    outcome: string;
    candidateCount: number | null;
    mode: string;
  } | null,
) {
  const current: Record<string, string> = {
    AVAILABLE: 'Available',
    DOWNLOADING: 'Downloading',
    QUEUED: 'Download queued',
    WAITING_FOR_STASH_MATCH: 'Waiting for Stash match',
    WHISPARR_IMPORT_PENDING: 'Awaiting import',
    WHISPARR_BLOCKED: 'Import or download blocked',
    ORPHANED_REQUEST: 'Missing in Whisparr',
    STATUS_UNAVAILABLE: 'Status needs refresh',
    SOURCES_UNAVAILABLE: 'Status unavailable',
    STALE_EVIDENCE: 'Status stale',
    VERIFYING_REQUEST: 'Verifying request',
  };
  if (current[condition]) return { code: condition, label: current[condition] };
  if (!attempt) return { code: 'UNKNOWN', label: 'No search history' };
  if (['queued', 'started', 'running'].includes(attempt.state.toLowerCase()))
    return {
      code: 'SEARCHING',
      label:
        attempt.state.toLowerCase() === 'queued'
          ? 'Search queued'
          : 'Searching',
    };
  const labels: Record<string, string> = {
    NO_CANDIDATES: 'No candidates returned',
    ALL_REJECTED: 'All candidates rejected',
    CANDIDATES: 'Candidates returned',
    INCOMPLETE: 'Search incomplete',
    UNKNOWN: 'Search results unknown',
  };
  return {
    code: attempt.outcome,
    label: labels[attempt.outcome] ?? 'Search results unknown',
  };
}
