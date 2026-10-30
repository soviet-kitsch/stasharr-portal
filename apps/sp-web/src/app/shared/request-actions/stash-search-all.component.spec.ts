import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { StashSearchAllComponent } from './stash-search-all.component';
const scene = (i: number) => ({ id: 'scene-' + i, title: 'Scene ' + i });
const snapshot = (items: any[], total = items.length, page = 1, version = 'stable') => ({
  items,
  total,
  page,
  perPage: 50,
  hasMore: page * 50 < total,
  selectionVersion: version,
});
const value = (state = 'AVAILABLE') => ({
  state,
  summary: 'Result',
  checkedAt: '2026-10-30T10:00:00Z',
  matches:
    state === 'AVAILABLE'
      ? [
          {
            id: 'local-1',
            label: 'Stash scene 1',
            viewUrl: 'https://media.example/stash/scenes/local-1',
            evidence: 'SOURCE_IDENTITY',
          },
        ]
      : [],
  libraryUrl: null,
  limitation: '',
});
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
describe('top-level Search Stash for all', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [StashSearchAllComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });
  function setup() {
    const fixture = TestBed.createComponent(StashSearchAllComponent);
    fixture.detectChanges();
    return { fixture, c: fixture.componentInstance as any };
  }
  it('is explicit and checks every page independently of filters and selection, one scene at a time', async () => {
    const { c } = setup();
    http.expectNone(() => true);
    const run = c.show();
    const first = http.expectOne((r) => r.url === '/api/acquisition/table');
    expect(first.request.params.get('lifecycle')).toBe('ANY');
    expect(first.request.params.get('perPage')).toBe('50');
    expect(first.request.params.has('q')).toBe(false);
    expect(first.request.params.has('blocker')).toBe(false);
    first.flush(
      snapshot(
        Array.from({ length: 50 }, (_, i) => scene(i)),
        51,
      ),
    );
    await tick();
    http.expectNone((r) => r.url.endsWith('/stash-availability'));
    http
      .expectOne((r) => r.url === '/api/acquisition/table' && r.params.get('page') === '2')
      .flush(snapshot([scene(50)], 51, 2));
    await tick();
    for (let i = 0; i < 51; i++) {
      const request = http.expectOne('/api/acquisition/scenes/scene-' + i + '/stash-availability');
      if (i < 50)
        http.expectNone('/api/acquisition/scenes/scene-' + (i + 1) + '/stash-availability');
      request.flush(value(i % 2 ? 'NOT_FOUND' : 'AVAILABLE'));
      await tick();
    }
    await run;
    expect(c.checked()).toBe(51);
    expect(c.available()).toBe(26);
    expect(c.notFound()).toBe(25);
    expect(c.pages()).toBe(2);
    expect(c.visible()).toHaveLength(50);
    http.expectNone((r) => r.method !== 'GET');
  });
  it('refuses a changed multi-page snapshot before checking a partial list', async () => {
    const { c } = setup();
    const run = c.show();
    http
      .expectOne((r) => r.url === '/api/acquisition/table')
      .flush(
        snapshot(
          Array.from({ length: 50 }, (_, i) => scene(i)),
          51,
        ),
      );
    await tick();
    http
      .expectOne((r) => r.url === '/api/acquisition/table')
      .flush(snapshot([scene(50)], 51, 2, 'changed'));
    await run;
    expect(c.error()).toContain('changed');
    expect(c.entries()).toEqual([]);
    http.expectNone((r) => r.url.endsWith('/stash-availability'));
  });
  it('cancels gathering without sending checks', async () => {
    const { c } = setup();
    const run = c.show();
    const request = http.expectOne((r) => r.url === '/api/acquisition/table');
    c.close();
    expect(request.cancelled).toBe(true);
    await run;
    expect(c.running()).toBe(false);
    http.expectNone((r) => r.url.endsWith('/stash-availability'));
  });
  it('stops remaining checks and preserves completed results', async () => {
    const { c } = setup();
    const run = c.show();
    http
      .expectOne((r) => r.url === '/api/acquisition/table')
      .flush(snapshot([scene(0), scene(1), scene(2)]));
    await tick();
    http.expectOne('/api/acquisition/scenes/scene-0/stash-availability').flush(value());
    await tick();
    const request = http.expectOne('/api/acquisition/scenes/scene-1/stash-availability');
    c.stop();
    expect(request.cancelled).toBe(true);
    await run;
    expect(c.checked()).toBe(1);
    expect(c.label(c.entries()[1])).toBe('Not checked');
    http.expectNone('/api/acquisition/scenes/scene-2/stash-availability');
  });
  it('reports failures as unknown and continues without inferring absence', async () => {
    const { c } = setup();
    const run = c.show();
    http.expectOne((r) => r.url === '/api/acquisition/table').flush(snapshot([scene(0), scene(1)]));
    await tick();
    http
      .expectOne('/api/acquisition/scenes/scene-0/stash-availability')
      .flush({}, { status: 503, statusText: 'Offline' });
    await tick();
    http.expectOne('/api/acquisition/scenes/scene-1/stash-availability').flush(value('NOT_FOUND'));
    await run;
    expect(c.unknown()).toBe(1);
    expect(c.notFound()).toBe(1);
    expect(c.available()).toBe(0);
  });
  it('does not trust a malformed successful response', async () => {
    const { c } = setup();
    const run = c.show();
    http.expectOne((r) => r.url === '/api/acquisition/table').flush(snapshot([scene(0)]));
    await tick();
    http.expectOne('/api/acquisition/scenes/scene-0/stash-availability').flush({});
    await run;
    expect(c.unknown()).toBe(1);
    expect(c.notFound()).toBe(0);
  });
  it('handles an empty acquisition list without a provider lookup', async () => {
    const { c } = setup();
    const run = c.show();
    http.expectOne((r) => r.url === '/api/acquisition/table').flush(snapshot([]));
    await run;
    expect(c.error()).toContain('No tracked acquisitions');
    http.expectNone((r) => r.url.endsWith('/stash-availability'));
  });
  it('starts a new explicit run without reusing stale positive results', async () => {
    const { c } = setup();
    let run = c.show();
    http.expectOne((r) => r.url === '/api/acquisition/table').flush(snapshot([scene(0)]));
    await tick();
    http.expectOne('/api/acquisition/scenes/scene-0/stash-availability').flush(value());
    await run;
    run = c.show();
    expect(c.available()).toBe(0);
    http.expectOne((r) => r.url === '/api/acquisition/table').flush(snapshot([scene(0)]));
    await tick();
    http.expectOne('/api/acquisition/scenes/scene-0/stash-availability').flush(value('NOT_FOUND'));
    await run;
    expect(c.notFound()).toBe(1);
  });
  it('orders all confirmed matches first before paginating, preserving order within each group', () => {
    const { c } = setup();
    c.entries.set(
      Array.from({ length: 60 }, (_, i) => ({
        ...scene(i),
        result: value([1, 59].includes(i) ? 'AVAILABLE' : 'NOT_FOUND'),
      })),
    );
    expect(
      c
        .visible()
        .slice(0, 3)
        .map((e: any) => e.id),
    ).toEqual(['scene-1', 'scene-59', 'scene-0']);
    expect(
      c
        .ordered()
        .filter((e: any) => e.result.state === 'NOT_FOUND')
        .map((e: any) => e.id),
    ).toEqual(
      Array.from({ length: 60 }, (_, i) => i)
        .filter((i) => ![1, 59].includes(i))
        .map((i) => 'scene-' + i),
    );
    http.expectNone(() => true);
  });
  it('only offers a frozen Portal-only review for confirmed copies, with no deletion before confirmation', () => {
    const { c } = setup();
    c.entries.set([
      { ...scene(0), result: value('NOT_FOUND') },
      { ...scene(1), result: value() },
      { ...scene(2), result: value('UNAVAILABLE') },
      { ...scene(3), result: { ...value(), matches: [] } },
    ]);
    c.reviewDeletion(c.entries());
    expect(c.deletionTargets().map((e: any) => e.id)).toEqual(['scene-1']);
    expect(c.deletionReviewOpen()).toBe(true);
    http.expectNone(() => true);
    c.deletionReviewOpen.set(false);
    http.expectNone((r) => r.method === 'POST');
  });
  it('deletes the Portal request, preserves copy links and prevents duplicate clicks', async () => {
    const { c } = setup();
    const changed = vi.spyOn(c.changed, 'emit');
    c.entries.set([{ ...scene(1), result: value() }]);
    c.reviewDeletion(c.removable());
    const run = c.deleteConfirmed();
    c.deleteConfirmed();
    const request = http.expectOne('/api/requests/batch/execute');
    expect(request.request.body).toEqual({
      kind: 'DISMISS',
      ids: ['scene-1'],
      operationKey: expect.any(String),
    });
    request.flush({ results: [{ id: 'scene-1', ok: true, result: { outcome: 'DISMISSED' } }] });
    await run;
    expect(c.entries()[0].removed).toBe(true);
    expect(c.entries()[0].result.matches[0].viewUrl).toContain('/scenes/local-1');
    expect(c.removable()).toEqual([]);
    expect(changed).toHaveBeenCalledOnce();
    c.deleteConfirmed();
    http.expectNone((r) => r.method === 'POST');
  });
  it('uses bounded groups of twenty and one stable operation key for the reviewed cleanup', async () => {
    const { c } = setup();
    c.entries.set(Array.from({ length: 45 }, (_, i) => ({ ...scene(i), result: value() })));
    c.reviewDeletion(c.removable());
    const run = c.deleteConfirmed();
    let key = '';
    for (const offset of [0, 20, 40]) {
      const request = http.expectOne('/api/requests/batch/execute');
      const ids = Array.from(
        { length: Math.min(20, 45 - offset) },
        (_, i) => 'scene-' + (offset + i),
      );
      expect(request.request.body.ids).toEqual(ids);
      key ||= request.request.body.operationKey;
      expect(request.request.body.operationKey).toBe(key);
      request.flush({
        results: ids.map((id) => ({ id, ok: true, result: { outcome: 'DISMISSED' } })),
      });
      await tick();
    }
    await run;
    expect(c.entries().every((e: any) => e.removed)).toBe(true);
  });
  it('retains the reviewed key after uncertain results and recovers without starting a new cleanup', async () => {
    const { c } = setup();
    c.entries.set(Array.from({ length: 21 }, (_, i) => ({ ...scene(i), result: value() })));
    c.reviewDeletion(c.removable());
    let run = c.deleteConfirmed();
    const first = http.expectOne('/api/requests/batch/execute');
    const key = first.request.body.operationKey;
    first.flush({
      results: first.request.body.ids.map((id: string) => ({
        id,
        ok: true,
        result: { outcome: 'DISMISSED' },
      })),
    });
    await tick();
    http.expectOne('/api/requests/batch/execute').flush({}, { status: 503, statusText: 'Offline' });
    await run;
    expect(c.entries().filter((e: any) => e.removed)).toHaveLength(20);
    expect(c.deletionPending()).toBe(true);
    http.expectNone((r) => r.method === 'POST');
    c.deletionReviewOpen.set(false);
    c.reviewDeletion([c.entries()[20]]);
    expect(c.deletionTargets()).toHaveLength(21);
    await c.show();
    http.expectNone((r) => r.url === '/api/acquisition/table');
    run = c.deleteConfirmed();
    for (const count of [20, 1]) {
      const request = http.expectOne('/api/requests/batch/execute');
      expect(request.request.body.operationKey).toBe(key);
      expect(request.request.body.ids).toHaveLength(count);
      request.flush({
        results: request.request.body.ids.map((id: string) => ({
          id,
          ok: true,
          result: { outcome: 'DISMISSED' },
        })),
      });
      await tick();
    }
    await run;
    expect(c.deletionPending()).toBe(false);
    expect(c.entries().every((e: any) => e.removed)).toBe(true);
  });
  it('does not mislabel an incomplete success response as a confirmed removal', async () => {
    const { c } = setup();
    c.entries.set([{ ...scene(1), result: value() }]);
    c.reviewDeletion(c.removable());
    const run = c.deleteConfirmed();
    http.expectOne('/api/requests/batch/execute').flush({ results: [] });
    await run;
    expect(c.entries()[0].removed).toBeUndefined();
    expect(c.deletionPending()).toBe(true);
  });
  it('leaves blocked requests in the results with their reason', async () => {
    const { c } = setup();
    c.entries.set([{ ...scene(1), result: value() }]);
    c.reviewDeletion(c.removable());
    const run = c.deleteConfirmed();
    http
      .expectOne('/api/requests/batch/execute')
      .flush({ results: [{ id: 'scene-1', ok: false, message: 'Another action is active.' }] });
    await run;
    expect(c.entries()[0].removed).not.toBe(true);
    expect(c.entries()[0].deletionProblem).toContain('Another action');
  });
  it('does not start cleanup during checks, and navigation cancels further queued groups', async () => {
    const { c } = setup();
    c.entries.set(Array.from({ length: 21 }, (_, i) => ({ ...scene(i), result: value() })));
    c.running.set(true);
    c.reviewDeletion(c.entries());
    expect(c.deletionTargets()).toEqual([]);
    c.running.set(false);
    c.reviewDeletion(c.removable());
    const run = c.deleteConfirmed();
    const request = http.expectOne('/api/requests/batch/execute');
    c.ngOnDestroy();
    expect(request.cancelled).toBe(true);
    await run;
    http.expectNone((r) => r.method === 'POST');
  });
});
