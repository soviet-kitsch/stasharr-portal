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

  const preview = (id: string, nativeId: number | null = 42) => ({
    sceneId: id,
    whisparrSceneId: nativeId,
    title: 'Synthetic entry',
    whisparrUrl: nativeId === null ? null : 'https://whisparr.example/movie/' + nativeId,
    filesKept: true,
    previewToken: 'signed-' + id,
    expiresAt: new Date(Date.now() + 300000).toISOString(),
  });
  async function reviewed(c: any, nativeId: number | null = 42) {
    const run = c.reviewDeletion(c.removable());
    for (const e of c.removable()) {
      http
        .expectOne('/api/requests/' + e.id + '/whisparr-entry-deletion-preview')
        .flush(preview(e.id, nativeId));
      await tick();
    }
    await run;
  }
  const removed = (nativeId: number | null = 42) => ({
    outcome: 'WHISPARR_ENTRY_CLEANED',
    whisparrSceneId: nativeId,
    filesKept: true,
  });
  it('only reviews confirmed copies, fetching previews without deletion before confirmation', async () => {
    const { c } = setup();
    c.entries.set([
      { ...scene(0), result: value('NOT_FOUND') },
      { ...scene(1), result: value() },
      { ...scene(2), result: value('UNAVAILABLE') },
      { ...scene(3), result: { ...value(), matches: [] } },
    ]);
    const run = c.reviewDeletion(c.entries());
    expect(c.deletionTargets().map((e: any) => e.id)).toEqual(['scene-1']);
    http.expectNone((r) => r.method === 'POST');
    http
      .expectOne('/api/requests/scene-1/whisparr-entry-deletion-preview')
      .flush(preview('scene-1'));
    await run;
    expect(c.deletionItems()[0].entryTarget.id).toBe(42);
    c.cancelReview();
    http.expectNone((r) => r.method === 'POST');
  });
  it('waits for reviewed Whisparr identity, deletes entry only, preserves copy links and blocks duplicate submits', async () => {
    const { c } = setup();
    const changed = vi.spyOn(c.changed, 'emit');
    c.entries.set([{ ...scene(1), result: value() }]);
    const review = c.reviewDeletion(c.removable());
    await c.deleteConfirmed();
    http.expectNone((r) => r.method === 'POST');
    http
      .expectOne('/api/requests/scene-1/whisparr-entry-deletion-preview')
      .flush(preview('scene-1'));
    await review;
    const run = c.deleteConfirmed();
    c.deleteConfirmed();
    const req = http.expectOne('/api/requests/scene-1/delete-whisparr-entry');
    expect(req.request.body).toEqual({
      operationKey: expect.any(String),
      previewToken: 'signed-scene-1',
      confirmDeleteEntry: true,
    });
    expect(req.request.body.deleteFiles).toBeUndefined();
    expect(req.request.body.confirmDeleteFiles).toBeUndefined();
    req.flush(removed());
    await run;
    expect(c.entries()[0].removed).toBe(true);
    expect(c.entries()[0].result.matches[0].viewUrl).toContain('/scenes/local-1');
    expect(changed).toHaveBeenCalledOnce();
    expect(c.removable()).toEqual([]);
    c.deleteConfirmed();
    http.expectNone((r) => r.method === 'POST');
  });
  it('supports verified absence without fabricating a Whisparr entry', async () => {
    const { c } = setup();
    c.entries.set([{ ...scene(1), result: value() }]);
    await reviewed(c, null);
    expect(c.deletionItems()[0].status).toContain('Portal only');
    const run = c.deleteConfirmed();
    http.expectOne('/api/requests/scene-1/delete-whisparr-entry').flush(removed(null));
    await run;
    expect(c.entries()[0].removed).toBe(true);
  });
  it('processes individually reviewed targets sequentially, with a distinct stable key per scene', async () => {
    const { c } = setup();
    c.entries.set(Array.from({ length: 21 }, (_, i) => ({ ...scene(i), result: value() })));
    await reviewed(c);
    const run = c.deleteConfirmed();
    const keys = new Set();
    for (let i = 0; i < 21; i++) {
      const req = http.expectOne('/api/requests/scene-' + i + '/delete-whisparr-entry');
      keys.add(req.request.body.operationKey);
      http.expectNone((r) => r.method === 'POST');
      req.flush(removed());
      await tick();
    }
    await run;
    expect(keys.size).toBe(21);
    expect(c.entries().every((e: any) => e.removed)).toBe(true);
  });
  it('retains original reviewed keys and tokens after partial unknown results and replays instead of issuing fresh deletion', async () => {
    const { c } = setup();
    c.entries.set([0, 1, 2].map((i) => ({ ...scene(i), result: value() })));
    await reviewed(c);
    let run = c.deleteConfirmed();
    const first = http.expectOne('/api/requests/scene-0/delete-whisparr-entry');
    const bodies = [first.request.body];
    first.flush(removed());
    await tick();
    const second = http.expectOne('/api/requests/scene-1/delete-whisparr-entry');
    bodies.push(second.request.body);
    second.flush({}, { status: 503, statusText: 'Offline' });
    await run;
    expect(c.entries().filter((e: any) => e.removed)).toHaveLength(1);
    expect(c.deletionPending()).toBe(true);
    http.expectNone('/api/requests/scene-2/delete-whisparr-entry');
    c.cancelReview();
    await c.show();
    await c.reviewDeletion([c.entries()[2]]);
    expect(c.deletionTargets()).toHaveLength(3);
    http.expectNone((r) => r.method === 'GET');
    run = c.deleteConfirmed();
    for (let i = 0; i < 3; i++) {
      const req = http.expectOne('/api/requests/scene-' + i + '/delete-whisparr-entry');
      if (i < 2) expect(req.request.body).toEqual(bodies[i]);
      req.flush(removed());
      await tick();
    }
    await run;
    expect(c.deletionPending()).toBe(false);
    expect(c.entries().every((e: any) => e.removed)).toBe(true);
  });
  it('allows a fresh reviewed attempt after the server confirms failure before dispatch', async () => {
    const { c } = setup();
    c.entries.set([0, 1].map((i) => ({ ...scene(i), result: value() })));
    await reviewed(c);
    const run = c.deleteConfirmed();
    const req = http.expectOne('/api/requests/scene-0/delete-whisparr-entry');
    const oldKey = req.request.body.operationKey;
    req.flush(
      { actionState: 'FAILED', message: 'The preview expired.' },
      { status: 409, statusText: 'Not sent' },
    );
    await run;
    expect(c.deletionPending()).toBe(false);
    expect(c.deletionComplete()).toBe(true);
    expect(c.entries()[0].deletionProblem).toContain('expired');
    http.expectNone('/api/requests/scene-1/delete-whisparr-entry');
    c.cancelReview();
    await reviewed(c);
    const next = c.deleteConfirmed();
    const retry = http.expectOne('/api/requests/scene-0/delete-whisparr-entry');
    expect(retry.request.body.operationKey).not.toBe(oldKey);
    retry.flush(removed());
    await tick();
    http.expectOne('/api/requests/scene-1/delete-whisparr-entry').flush(removed());
    await next;
  });
  it('does not mislabel a malformed or wrong-scene success as confirmed removal', async () => {
    const { c } = setup();
    c.entries.set([{ ...scene(1), result: value() }]);
    await reviewed(c);
    const run = c.deleteConfirmed();
    http.expectOne('/api/requests/scene-1/delete-whisparr-entry').flush(removed(99));
    await run;
    expect(c.entries()[0].removed).toBeUndefined();
    expect(c.deletionPending()).toBe(true);
  });
  it('keeps blocked or unverified previews, while allowing only other verified items to proceed', async () => {
    const { c } = setup();
    c.entries.set([0, 1].map((i) => ({ ...scene(i), result: value() })));
    const review = c.reviewDeletion(c.removable());
    http
      .expectOne('/api/requests/scene-0/whisparr-entry-deletion-preview')
      .flush({ message: 'An active transfer is running.' }, { status: 409, statusText: 'Blocked' });
    await tick();
    http
      .expectOne('/api/requests/scene-1/whisparr-entry-deletion-preview')
      .flush(preview('scene-1'));
    await review;
    expect(c.deletionItems()[0].message).toContain('active transfer');
    expect(c.readyTargets()).toHaveLength(1);
    const run = c.deleteConfirmed();
    http.expectOne('/api/requests/scene-1/delete-whisparr-entry').flush(removed());
    await run;
    expect(c.entries()[0].removed).not.toBe(true);
    http.expectNone('/api/requests/scene-0/delete-whisparr-entry');
  });
  it('blocks malformed previews and cancels in-flight review without later deletion', async () => {
    const { c } = setup();
    c.entries.set([0, 1].map((i) => ({ ...scene(i), result: value() })));
    const run = c.reviewDeletion(c.removable());
    http.expectOne('/api/requests/scene-0/whisparr-entry-deletion-preview').flush({});
    await tick();
    expect(c.readyTargets()).toHaveLength(0);
    const pending = http.expectOne('/api/requests/scene-1/whisparr-entry-deletion-preview');
    c.cancelReview();
    expect(pending.cancelled).toBe(true);
    await run;
    expect(c.previewLoading()).toBe(false);
    await c.deleteConfirmed();
    http.expectNone((r) => r.method === 'POST');
  });
  it('does not start cleanup during checks, and navigation cancels later deletions', async () => {
    const { c } = setup();
    c.entries.set([0, 1].map((i) => ({ ...scene(i), result: value() })));
    c.running.set(true);
    await c.reviewDeletion(c.entries());
    expect(c.deletionTargets()).toEqual([]);
    c.running.set(false);
    await reviewed(c);
    const run = c.deleteConfirmed();
    const req = http.expectOne('/api/requests/scene-0/delete-whisparr-entry');
    c.ngOnDestroy();
    expect(req.cancelled).toBe(true);
    await run;
    http.expectNone((r) => r.method === 'POST');
  });
});
