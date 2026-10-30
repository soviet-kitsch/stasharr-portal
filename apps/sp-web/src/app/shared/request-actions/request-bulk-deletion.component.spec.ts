import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { RequestBatchActionsComponent } from './request-batch-actions.component';
import { DeletionReviewComponent } from './deletion-review.component';
import { By } from '@angular/platform-browser';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
const target = (id: string) => ({
  whisparrSceneId: 42,
  title: 'Synthetic ' + id,
  folder: '/library/' + id,
  files: [{ id: 7, path: '/library/' + id + '/video.mp4', size: 123 }],
  previewToken: 'signed-' + id,
  expiresAt: '2099-01-01T00:00:00Z',
  whisparrUrl: 'https://whisparr.invalid/movie/42',
  recovery: 'Deletion may be permanent.',
});
describe('bulk scene and file deletion', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RequestBatchActionsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AppNotificationsService, useValue: { success: vi.fn(), info: vi.fn() } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });
  function setup(count = 3) {
    const fixture = TestBed.createComponent(RequestBatchActionsComponent);
    const scenes = Array.from({ length: count }, (_, i) => ({
      id: 'scene-' + i,
      title: 'Scene ' + i,
    }));
    fixture.componentRef.setInput('scenes', scenes);
    fixture.detectChanges();
    const component = fixture.componentInstance as any;
    component.preview('DISMISS');
    for (let offset = 0; offset < count; offset += 20) {
      http.expectOne('/api/requests/batch/preview').flush({
        results: scenes.slice(offset, offset + 20).map((s) => ({ id: s.id, eligible: true })),
      });
    }
    return { fixture, component, scenes };
  }
  function nativeReady(component: any, scenes: { id: string }[]) {
    component.chooseDeletionFiles(true);
    for (const scene of scenes)
      http
        .expectOne('/api/requests/' + scene.id + '/whisparr-deletion-preview')
        .flush(target(scene.id));
  }
  it('defaults to Portal-only and never reads Whisparr before opting in', () => {
    const { component } = setup();
    expect(component.deleteFiles()).toBe(false);
    http.expectNone((r) => r.url.endsWith('/whisparr-deletion-preview'));
    component.confirm();
    const request = http.expectOne('/api/requests/batch/execute');
    expect(request.request.body.kind).toBe('DISMISS');
    expect(request.request.body).not.toHaveProperty('confirmDeleteFiles');
    request.flush({ results: request.request.body.ids.map((id: string) => ({ id, ok: true })) });
  });
  it('previews sequentially, skips blocked matches explicitly, and sends only acknowledged signed targets', () => {
    const { component, scenes } = setup();
    component.chooseDeletionFiles(true);
    component.confirm();
    http.expectNone((r) => r.method === 'POST');
    http.expectOne('/api/requests/scene-0/whisparr-deletion-preview').flush(target('scene-0'));
    http
      .expectOne('/api/requests/scene-1/whisparr-deletion-preview')
      .flush({ message: 'Ambiguous match' }, { status: 409, statusText: 'Conflict' });
    http.expectOne('/api/requests/scene-2/whisparr-deletion-preview').flush(target('scene-2'));
    expect(component.skippedCount()).toBe(1);
    expect(component.eligibleIds()).toEqual(['scene-0', 'scene-2']);
    component.confirm();
    http.expectNone((r) => r.method === 'POST');
    component.acknowledged.set(true);
    component.confirm();
    component.confirm();
    const first = http.expectOne('/api/requests/scene-0/delete-whisparr');
    http.expectNone('/api/requests/scene-2/delete-whisparr');
    expect(first.request.body).toEqual({
      operationKey: expect.any(String),
      previewToken: 'signed-scene-0',
      confirmDeleteFiles: true,
    });
    first.flush({ outcome: 'WHISPARR_SCENE_REMOVED' });
    const second = http.expectOne('/api/requests/scene-2/delete-whisparr');
    expect(second.request.body.operationKey).not.toBe(first.request.body.operationKey);
    second.flush({ outcome: 'WHISPARR_SCENE_REMOVED' });
    http.expectNone('/api/requests/scene-1/dismiss');
    expect(component.completed()).toBe(true);
    expect(component.rows().filter((r: any) => r.ok)).toHaveLength(2);
    expect(component.rows().find((r: any) => r.id === scenes[1].id).message).toBe(
      'Ambiguous match',
    );
  });
  it('stops at an uncertain deletion, preserves successes, and never resends the batch', () => {
    const { component, scenes, fixture } = setup();
    nativeReady(component, scenes);
    component.acknowledged.set(true);
    component.confirm();
    http
      .expectOne('/api/requests/scene-0/delete-whisparr')
      .flush({ outcome: 'WHISPARR_SCENE_REMOVED' });
    http
      .expectOne('/api/requests/scene-1/delete-whisparr')
      .flush({}, { status: 503, statusText: 'Offline' });
    http.expectNone('/api/requests/scene-2/delete-whisparr');
    expect(component.rows()[0].ok).toBe(true);
    expect(component.rows()[1].uncertain).toBe(true);
    expect(component.rows()[2].ok).toBeUndefined();
    expect(component.error()).toContain('later items were not sent');
    component.confirm();
    component.previewDeletionFiles();
    http.expectNone((r) => r.method === 'POST');
    component.inspect('scene-1');
    http.expectNone('/api/requests/scene-1/history');
    fixture.detectChanges();
    component.afterHide();
    http
      .expectOne('/api/requests/scene-1/history')
      .flush({ actions: [], activeActionId: 'pending' });
    http
      .expectOne('/api/requests/scene-1/diagnostics')
      .flush({ summary: null, events: [], attempts: [], limitations: [], sync: null });
  });
  it('does not treat an unrecognized HTTP success body as proof of deletion', () => {
    const { component, scenes } = setup();
    nativeReady(component, scenes);
    component.acknowledged.set(true);
    component.confirm();
    http.expectOne('/api/requests/scene-0/delete-whisparr').flush({});
    expect(component.rows()[0].ok).toBe(false);
    expect(component.rows()[0].uncertain).toBe(true);
    http.expectNone('/api/requests/scene-1/delete-whisparr');
  });
  it('also stops on a safe pre-dispatch failure without calling it an uncertain outcome', () => {
    const { component, scenes } = setup();
    nativeReady(component, scenes);
    component.acknowledged.set(true);
    component.confirm();
    http
      .expectOne('/api/requests/scene-0/delete-whisparr')
      .flush(
        { actionState: 'FAILED', message: 'Files changed' },
        { status: 409, statusText: 'Conflict' },
      );
    expect(component.rows()[0].uncertain).toBe(false);
    http.expectNone('/api/requests/scene-1/delete-whisparr');
  });
  it('does not delete anything if any approved preview expired before confirmation', () => {
    const { component } = setup(1);
    component.chooseDeletionFiles(true);
    http
      .expectOne('/api/requests/scene-0/whisparr-deletion-preview')
      .flush({ ...target('scene-0'), expiresAt: '2000-01-01' });
    component.acknowledged.set(true);
    component.confirm();
    http.expectNone((r) => r.method === 'POST');
    expect(component.acknowledged()).toBe(false);
    expect(component.error()).toContain('expired');
  });
  it('ignores stale preview responses and stops checking further items after cancellation', () => {
    const { component } = setup();
    component.chooseDeletionFiles(true);
    const request = http.expectOne('/api/requests/scene-0/whisparr-deletion-preview');
    component.close(false);
    request.flush(target('scene-0'));
    expect(component.eligibleIds()).toEqual([]);
    http.expectNone('/api/requests/scene-1/whisparr-deletion-preview');
  });
  it('binds confirmation to the frozen reviewed selection and supports more than twenty scenes', () => {
    const { component, scenes, fixture } = setup(21);
    nativeReady(component, scenes);
    fixture.componentRef.setInput('scenes', [{ id: 'other', title: 'Other selection' }]);
    fixture.detectChanges();
    component.acknowledged.set(true);
    component.confirm();
    for (const scene of scenes)
      http
        .expectOne('/api/requests/' + scene.id + '/delete-whisparr')
        .flush({ outcome: 'WHISPARR_SCENE_REMOVED' });
    http.expectNone('/api/requests/other/delete-whisparr');
    expect(component.rows().filter((r: any) => r.ok)).toHaveLength(21);
  });
  it('rechecks Portal-only eligibility and clears acknowledgment when opting out', () => {
    const { component, scenes } = setup();
    nativeReady(component, scenes);
    component.acknowledged.set(true);
    component.chooseDeletionFiles(false);
    http
      .expectOne('/api/requests/batch/preview')
      .flush({ results: scenes.map((s) => ({ id: s.id, eligible: true })) });
    expect(component.deleteFiles()).toBe(false);
    expect(component.acknowledged()).toBe(false);
    expect(component.rows().some((r: any) => r.target)).toBe(false);
  });
  it('uses keyboard-accessible tabs with connected panels and keeps impact out of the item view', () => {
    const { fixture } = setup(1);
    fixture.detectChanges();
    const review = fixture.debugElement.query(By.directive(DeletionReviewComponent));
    const tabs = review.nativeElement.querySelectorAll(
      '[role="tab"]',
    ) as NodeListOf<HTMLButtonElement>;
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    const impact = review.nativeElement.querySelectorAll('[role="tabpanel"]')[1] as HTMLElement;
    expect(impact.hidden).toBe(true);
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    expect(document.activeElement).toBe(tabs[1]);
    expect(impact.hidden).toBe(false);
    expect(impact.id).toBe(tabs[1].getAttribute('aria-controls'));
  });
});
