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
});
