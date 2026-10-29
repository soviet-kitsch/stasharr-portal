import { parseDecisions, safeText, shortStatus } from './diagnostics.util';

describe('request diagnostic evidence', () => {
  const release = {
    title: 'Example release',
    approved: false,
    rejected: true,
    rejections: ['Size limit', 'Not enough seeders'],
    size: 1234,
    mappedMovieId: 7,
    seeders: 0,
  };
  it('distinguishes an empty evaluated response from a failed or malformed response', () => {
    expect(parseDecisions([])).toMatchObject({
      outcome: 'NO_CANDIDATES',
      candidateCount: 0,
    });
    expect(() => parseDecisions({ items: [] })).toThrow('Incomplete');
    expect(() => parseDecisions([{ ...release, rejections: null }])).toThrow(
      'Incomplete',
    );
  });
  it('retains native order, all rejection reasons and unknown versus zero values', () => {
    const result = parseDecisions([
      release,
      { ...release, title: 'Second', seeders: undefined },
    ]);
    expect(result.outcome).toBe('ALL_REJECTED');
    expect(result.candidates.map((r) => r.rank)).toEqual([1, 2]);
    expect(result.candidates[0].rejections).toEqual(release.rejections);
    expect(result.candidates[0].seeders).toBe(0);
    expect(result.candidates[1].seeders).toBeNull();
  });
  it('does not call mixed accepted and rejected candidates all rejected', () => {
    expect(
      parseDecisions([
        release,
        { ...release, approved: true, rejected: false, rejections: [] },
      ]),
    ).toMatchObject({ outcome: 'CANDIDATES', rejectedCount: 1 });
  });
  it('bounds candidate detail without falsifying complete evaluated totals', () => {
    const result = parseDecisions(Array.from({ length: 250 }, () => release));
    expect(result.candidates).toHaveLength(200);
    expect(result.candidateCount).toBe(250);
    expect(result.rejectedCount).toBe(250);
  });
  it('does not retain download URLs or key-bearing native text', () => {
    const result = parseDecisions([
      {
        ...release,
        downloadUrl: 'https://indexer/?apikey=secret',
        rejections: ['See https://site/?apikey=secret token=secret'],
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result.candidates[0]).not.toHaveProperty('downloadUrl');
    expect(safeText('password=secret\nraw')).not.toContain('secret');
  });
  it('prioritizes current download/import/stale evidence over an older rejection', () => {
    const attempt = {
      state: 'COMPLETED',
      outcome: 'ALL_REJECTED',
      candidateCount: 6,
      mode: 'DIAGNOSTIC',
    };
    expect(shortStatus('DOWNLOADING', attempt).label).toBe('Downloading');
    expect(shortStatus('WAITING_FOR_STASH_MATCH', attempt).label).toBe(
      'Waiting for Stash match',
    );
    expect(shortStatus('STATUS_UNAVAILABLE', attempt).label).toBe(
      'Status needs refresh',
    );
    expect(shortStatus('WAITING_FOR_RELEASE', attempt).label).toBe(
      'All candidates rejected',
    );
  });
  it('does not infer zero or never searched from absent/finished commands', () => {
    expect(shortStatus('WAITING_FOR_RELEASE').label).toBe('No search history');
    expect(
      shortStatus('WAITING_FOR_RELEASE', {
        state: 'completed',
        outcome: 'UNKNOWN',
        candidateCount: null,
        mode: 'AUTOMATIC',
      }).label,
    ).toBe('Search results unknown');
  });
});
