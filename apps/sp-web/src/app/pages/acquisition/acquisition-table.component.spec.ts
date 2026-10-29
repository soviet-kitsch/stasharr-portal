import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { AcquisitionTableComponent } from './acquisition-table.component';

function row(id: string) {
  return {
    id,
    title: 'Example ' + id,
    studio: 'Example Studio',
    studioId: null,
    status: { state: 'REQUESTED' },
    performers: [],
    diagnostics: {
      code: 'ALL_REJECTED',
      label: 'All candidates rejected',
      detail: 'Diagnostic search: 6 candidates. Size limit.',
    },
    requestedAt: '2026-10-01',
    activityAt: '2026-10-29',
    checkedAt: null,
  };
}
function response(items: any[], more = false, page = 1, total = items.length) {
  return {
    items,
    total,
    trackedCount: total,
    page,
    perPage: 24,
    hasMore: more,
    countsByLifecycle: { REQUESTED: total, DOWNLOADING: 0, IMPORT_PENDING: 0, FAILED: 0 },
    blockerCounts: { ALL_REJECTED: total },
    hydraConfigured: true,
    selectionVersion: 'stable',
  };
}

describe('acquisition table', () => {
  let http: HttpTestingController;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  beforeEach(async () => {
    params = new BehaviorSubject(convertToParamMap({}));
    await TestBed.configureTestingModule({
      imports: [AcquisitionTableComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParamMap: params } },
        { provide: AppNotificationsService, useValue: { success() {}, error() {}, info() {} } },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });
  function setup() {
    const fixture = TestBed.createComponent(AcquisitionTableComponent);
    fixture.detectChanges();
    http.expectOne((r) => r.url === '/api/acquisition/table').flush(response([row('one')]));
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance as any };
  }
  it('shows a compact short status without fetching each scene or native history', () => {
    const { fixture } = setup();
    expect(fixture.nativeElement.querySelector('table')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('All candidates rejected');
    expect(fixture.nativeElement.querySelectorAll('.acquisition-card')).toHaveLength(0);
    http.expectNone((r) => r.url.includes('/diagnostics'));
    fixture.destroy();
  });
  it('selects all filtered rows across API-sized pages and preserves exact identities', async () => {
    const { fixture, component } = setup();
    const pending = component.selectAll();
    const rows = Array.from({ length: 120 }, (_, i) => row(String(i)));
    for (let page = 1; page <= 3; page++) {
      const request = http.expectOne(
        (r) =>
          r.url === '/api/acquisition/table' &&
          r.params.get('page') === String(page) &&
          r.params.get('perPage') === '50',
      );
      request.flush(response(rows.slice((page - 1) * 50, page * 50), page < 3, page, 120));
      await Promise.resolve();
    }
    await pending;
    expect(component.selected().map((r: any) => r.id)).toEqual(rows.map((r) => r.id));
    fixture.destroy();
  });
  it('leaves previous selection unchanged when the queue snapshot changes', async () => {
    const { fixture, component } = setup();
    component.toggle(row('previous'));
    const pending = component.selectAll();
    http
      .expectOne((r) => r.params.get('perPage') === '50')
      .flush(response([row('one')], true, 1, 2));
    await Promise.resolve();
    http
      .expectOne((r) => r.params.get('page') === '2')
      .flush({ ...response([row('two')], false, 2, 2), selectionVersion: 'changed' });
    await pending;
    expect(component.selected().map((r: any) => r.id)).toEqual(['previous']);
    expect(component.message()).toContain('unchanged');
    fixture.destroy();
  });
  it('preserves selection across paging and clears it on filter changes', () => {
    const { fixture, component } = setup();
    component.toggle(row('one'));
    params.next(convertToParamMap({ page: '2' }));
    http.expectOne((r) => r.params.get('page') === '2').flush(response([row('two')], false, 2));
    expect(component.selectedRow('one')).toBe(true);
    params.next(convertToParamMap({ lifecycle: 'IMPORT_PENDING' }));
    http.expectOne((r) => r.params.get('lifecycle') === 'IMPORT_PENDING').flush(response([]));
    expect(component.selected()).toEqual([]);
    fixture.destroy();
  });
  it('ignores a selection response from an obsolete filter', async () => {
    const { fixture, component } = setup();
    const pending = component.selectAll();
    const obsolete = http.expectOne((r) => r.params.get('perPage') === '50');
    params.next(convertToParamMap({ lifecycle: 'FAILED' }));
    http.expectOne((r) => r.params.get('lifecycle') === 'FAILED').flush(response([]));
    obsolete.flush(response([row('old')]));
    await pending;
    expect(component.selected()).toEqual([]);
    fixture.destroy();
  });
});
