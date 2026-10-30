import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { RequestActionsComponent } from './request-actions.component';
import { RequestBatchActionsComponent } from './request-batch-actions.component';
import { SceneRequestModalComponent } from '../scene-request-modal/scene-request-modal.component';
import { FormGroup } from '@angular/forms';

describe('request action controls', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RequestActionsComponent, RequestBatchActionsComponent],
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

  function button(fixture: { nativeElement: HTMLElement }, label: string): HTMLButtonElement {
    const result = Array.from(
      new Set([
        ...fixture.nativeElement.querySelectorAll<HTMLButtonElement>('button'),
        ...document.querySelectorAll<HTMLButtonElement>('.app-review-dialog button'),
      ]),
    ).find((item) => item.textContent?.trim() === label);
    if (!result) throw new Error('Missing button: ' + label);
    return result;
  }
  function renderedText(fixture: { nativeElement: HTMLElement }): string {
    return (
      (fixture.nativeElement.textContent ?? '') +
      Array.from(document.querySelectorAll('.app-review-dialog'))
        .map((dialog) => dialog.textContent ?? '')
        .join(' ')
    );
  }
  function single() {
    const fixture = TestBed.createComponent(RequestActionsComponent);
    fixture.componentRef.setInput('sceneId', 'scene-1');
    fixture.componentRef.setInput('sceneTitle', 'Example');
    fixture.componentRef.setInput('condition', 'WAITING_FOR_RELEASE');
    fixture.detectChanges();
    return fixture;
  }

  it('requires confirmation before deleting and describes the limited scope', async () => {
    const fixture = single();
    button(fixture, 'Delete request').click();
    fixture.detectChanges();
    await fixture.whenStable();
    http.expectNone((request) => request.method === 'POST');
    expect(renderedText(fixture)).toContain('downloads and media files remain unchanged');
    const changed = vi.spyOn(fixture.componentInstance.changed, 'emit');
    button(fixture, 'Delete from Portal').click();
    const request = http.expectOne('/api/requests/scene-1/dismiss');
    expect(request.request.body.operationKey).toBeTruthy();
    request.flush({ outcome: 'DISMISSED' });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('opens secondary compact actions in an overflow menu and retains deletion confirmation', async () => {
    const fixture = single();
    fixture.componentRef.setInput('compact', true);
    fixture.detectChanges();
    const more = fixture.nativeElement.querySelector('[aria-label="More request actions"]');
    more.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const menu = document.querySelector('.app-request-overflow')!;
    expect(menu.textContent).toContain('Request history');
    const remove = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (item) => item.textContent?.includes('Delete request'),
    )!;
    remove.querySelector<HTMLElement>('.p-menu-item-link')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(renderedText(fixture)).toContain('downloads and media files remain unchanged');
    http.expectNone((r) => r.method === 'POST');
    fixture.destroy();
  });
  it('prevents repeated search clicks while the first action is in flight', () => {
    const fixture = single();
    button(fixture, 'Search again').click();
    button(fixture, 'Search again').click();
    http.expectOne('/api/requests/scene-1/search').flush({ outcome: 'ALREADY_QUEUED' });
    fixture.detectChanges();
    expect(renderedText(fixture)).toContain('Already in the download queue.');
  });

  it('offers an outcome check after an uncertain response without sending another search', async () => {
    const fixture = single();
    button(fixture, 'Search again').click();
    http
      .expectOne('/api/requests/scene-1/search')
      .flush(
        { message: 'Check the outcome.', actionState: 'UNCERTAIN' },
        { status: 409, statusText: 'Conflict' },
      );
    http
      .expectOne('/api/requests/scene-1/history')
      .flush({ dismissed: false, activeActionId: 'pending', actions: [] });
    fixture.detectChanges();
    await fixture.whenStable();
    button(fixture, 'Check outcome').click();
    http.expectOne('/api/requests/scene-1/outcome').flush({ outcome: 'NO_PENDING_ACTION' });
    http
      .expectOne('/api/requests/scene-1/history')
      .flush({ dismissed: false, activeActionId: null, actions: [] });
    http.expectNone('/api/requests/scene-1/search');
  });

  it('previews a batch first, executes only eligible rows and reports per-row outcomes', async () => {
    const fixture = TestBed.createComponent(RequestBatchActionsComponent);
    fixture.componentRef.setInput('scenes', [
      { id: 'one', title: 'First' },
      { id: 'two', title: 'Second' },
    ]);
    fixture.detectChanges();
    button(fixture, 'Delete selected').click();
    http.expectOne('/api/requests/batch/preview').flush({
      results: [
        { id: 'one', eligible: true, message: 'Remove from Portal only.' },
        { id: 'two', eligible: false, message: 'Action already running.' },
      ],
    });
    http.expectNone('/api/requests/batch/execute');
    fixture.detectChanges();
    await fixture.whenStable();
    button(fixture, 'Confirm 1 deletions from Portal').click();
    const request = http.expectOne('/api/requests/batch/execute');
    expect(request.request.body.ids).toEqual(['one']);
    request.flush({ results: [{ id: 'one', ok: true, result: { outcome: 'DISMISSED' } }] });
    fixture.detectChanges();
    expect(renderedText(fixture)).toContain('Completed');
  });

  it('requires legacy settings to be chosen and can collect batch settings without submitting a scene', async () => {
    const fixture = TestBed.createComponent(SceneRequestModalComponent);
    fixture.componentRef.setInput('sceneId', 'scene-1');
    fixture.componentRef.setInput('settingsOnly', true);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    http.expectOne('/api/requests/scene-1/options?scope=batch').flush({
      scene: { stashId: 'scene-1', title: 'Example', studio: 'Studio' },
      settingsNotice: 'Choose settings for this older request.',
      defaults: {
        monitored: true,
        searchForMovie: true,
        rootFolderPath: null,
        qualityProfileId: null,
        tags: [],
      },
      rootFolders: [{ id: 1, path: '/data', accessible: true }],
      qualityProfiles: [{ id: 2, name: 'HD' }],
      tags: [],
    });
    fixture.detectChanges();
    await fixture.whenStable();
    const form = (fixture.componentInstance as unknown as { requestForm: FormGroup }).requestForm;
    expect(form.get('rootFolderPath')?.value).toBe('');
    expect(form.get('qualityProfileId')?.value).toBeNull();
    const selected = vi.spyOn(fixture.componentInstance.settingsSelected, 'emit');
    fixture.nativeElement
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(selected).not.toHaveBeenCalled();
    form.patchValue({ rootFolderPath: '/data', qualityProfileId: 2 });
    fixture.nativeElement
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(selected).toHaveBeenCalledWith(
      expect.objectContaining({ rootFolderPath: '/data', qualityProfileId: 2 }),
    );
    http.expectNone((request) => request.method === 'POST');
  });
  it('prefills the actual returned defaults instead of the first options without submitting automatically', async () => {
    const fixture = TestBed.createComponent(SceneRequestModalComponent);
    fixture.componentRef.setInput('sceneId', 'scene-1');
    fixture.componentRef.setInput('rerequest', true);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    http.expectOne('/api/requests/scene-1/options?scope=resume').flush({
      scene: { stashId: 'scene-1', title: 'Example', studio: 'Studio' },
      requiresSettings: true,
      defaults: {
        monitored: true,
        searchForMovie: true,
        rootFolderPath: '/preferred',
        qualityProfileId: 2,
        tags: [],
      },
      defaultSources: { rootFolderPath: 'CONFIGURED', qualityProfileId: 'CONFIGURED' },
      rootFolders: [
        { id: 1, path: '/first', accessible: true },
        { id: 2, path: '/preferred', accessible: true },
      ],
      qualityProfiles: [
        { id: 1, name: 'First' },
        { id: 2, name: 'Preferred' },
      ],
      tags: [],
    });
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance as any;
    expect(component.requestForm.value).toMatchObject({
      rootFolderPath: '/preferred',
      qualityProfileId: 2,
    });
    expect(renderedText(fixture)).toContain('Configured default');
    http.expectNone((request) => request.method === 'POST');
  });

  it('resumes an existing queued request without forcing unused creation settings', async () => {
    const fixture = TestBed.createComponent(SceneRequestModalComponent);
    fixture.componentRef.setInput('sceneId', 'scene-1');
    fixture.componentRef.setInput('rerequest', true);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    http.expectOne('/api/requests/scene-1/options?scope=resume').flush({
      scene: { stashId: 'scene-1', title: 'Example', studio: 'Studio' },
      requiresSettings: false,
      plannedAction: 'ALREADY_QUEUED',
      plannedMessage: 'Reuse the existing download.',
      defaults: {
        monitored: true,
        searchForMovie: true,
        rootFolderPath: null,
        qualityProfileId: null,
        tags: [],
      },
      rootFolders: [],
      qualityProfiles: [],
      tags: [],
    });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#request-root-folder')).toBeNull();
    expect(renderedText(fixture)).toContain('Reuse the existing download.');
    (fixture.componentInstance as any).submitRequest();
    const submitted = http.expectOne('/api/requests/scene-1/rerequest');
    expect(submitted.request.body).not.toHaveProperty('rootFolderPath');
    expect(submitted.request.body).not.toHaveProperty('qualityProfileId');
    expect(submitted.request.body.operationKey).toBeTruthy();
    submitted.flush({
      accepted: true,
      alreadyExists: true,
      stashId: 'scene-1',
      whisparrMovieId: 42,
      outcome: 'ALREADY_QUEUED',
      message: 'Existing active acquisition reused.',
    });
    expect(TestBed.inject(AppNotificationsService).success).toHaveBeenCalledWith(
      'Existing active acquisition reused.',
      expect.any(String),
    );
  });

  it('can confirm an all-existing batch without opening creation settings and reports its reused job', async () => {
    const fixture = TestBed.createComponent(RequestBatchActionsComponent);
    fixture.componentRef.setInput('scenes', [{ id: 'scene-1', title: 'Example' }]);
    fixture.detectChanges();
    button(fixture, 'Re-request selected').click();
    http.expectOne('/api/requests/batch/preview').flush({
      results: [
        {
          id: 'scene-1',
          eligible: true,
          requiresSettings: false,
          plannedAction: 'ALREADY_QUEUED',
          message: 'Reuse the current queue entry.',
        },
      ],
    });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(renderedText(fixture)).not.toContain('Choose acquisition settings');
    button(fixture, 'Confirm 1 actions').click();
    const request = http.expectOne('/api/requests/batch/execute');
    expect(request.request.body).not.toHaveProperty('settings');
    request.flush({
      results: [
        {
          id: 'scene-1',
          ok: true,
          result: { outcome: 'ALREADY_QUEUED', message: 'Existing download reused.' },
        },
      ],
    });
    fixture.detectChanges();
    expect(renderedText(fixture)).toContain('Existing download reused.');
  });

  it('still requires settings review for a mixed batch containing a missing entry', async () => {
    const fixture = TestBed.createComponent(RequestBatchActionsComponent);
    fixture.componentRef.setInput('scenes', [
      { id: 'active', title: 'Active' },
      { id: 'missing', title: 'Missing' },
    ]);
    fixture.detectChanges();
    button(fixture, 'Re-request selected').click();
    http.expectOne('/api/requests/batch/preview').flush({
      results: [
        { id: 'active', eligible: true, requiresSettings: false, plannedAction: 'ALREADY_QUEUED' },
        { id: 'missing', eligible: true, requiresSettings: true, plannedAction: 'CREATE_MOVIE' },
      ],
    });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(button(fixture, 'Confirm 2 actions').disabled).toBe(true);
    button(fixture, 'Choose acquisition settings').click();
    fixture.detectChanges();
    http.expectOne('/api/requests/missing/options?scope=batch').flush({
      scene: { stashId: 'missing', title: 'Missing', studio: 'Studio' },
      defaults: {
        monitored: true,
        searchForMovie: true,
        rootFolderPath: '/default',
        qualityProfileId: 2,
        tags: [],
      },
      rootFolders: [{ id: 1, path: '/default', accessible: true }],
      qualityProfiles: [{ id: 2, name: 'HD' }],
      tags: [],
    });
    http.expectNone((request) => request.method === 'POST');
  });

  it('shows the concrete resume outcome in retained request history', async () => {
    const fixture = single();
    button(fixture, 'Request history').click();
    http.expectOne('/api/requests/scene-1/history').flush({
      dismissed: false,
      activeActionId: null,
      actions: [
        {
          id: 'action',
          kind: 'RE_REQUEST',
          state: 'SUCCEEDED',
          createdAt: new Date().toISOString(),
          result: {
            outcome: 'UPSTREAM_BLOCKED',
            message: 'Queue blocked: destination needs attention.',
          },
        },
      ],
    });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(renderedText(fixture)).toContain('Queue blocked: destination needs attention.');
  });
  it('reviews and executes more than twenty selected requests in bounded sequential batches', async () => {
    const fixture = TestBed.createComponent(RequestBatchActionsComponent);
    const scenes = Array.from({ length: 45 }, (_, i) => ({ id: `row-${i}`, title: `Row ${i}` }));
    fixture.componentRef.setInput('scenes', scenes);
    fixture.detectChanges();
    button(fixture, 'Search selected').click();
    let key = '';
    for (const offset of [0, 20, 40]) {
      const request = http.expectOne('/api/requests/batch/preview');
      const ids = scenes.slice(offset, offset + 20).map((row) => row.id);
      expect(request.request.body.ids).toEqual(ids);
      key ||= request.request.body.operationKey;
      expect(request.request.body.operationKey).toBe(key);
      request.flush({
        results: ids.map((id) => ({ id, eligible: true, requiresSettings: false })),
      });
    }
    http.expectNone('/api/requests/batch/execute');
    fixture.detectChanges();
    await fixture.whenStable();
    button(fixture, 'Confirm 45 actions').click();
    for (const offset of [0, 20, 40]) {
      const request = http.expectOne('/api/requests/batch/execute');
      const ids = scenes.slice(offset, offset + 20).map((row) => row.id);
      expect(request.request.body.ids).toEqual(ids);
      expect(request.request.body.operationKey).toBe(key);
      request.flush({
        results: ids.map((id) => ({ id, ok: true, result: { outcome: 'SEARCH_STARTED' } })),
      });
    }
    fixture.detectChanges();
    expect((fixture.componentInstance as any).rows()).toHaveLength(45);
    expect((fixture.componentInstance as any).completed()).toBe(true);
  });
  it('stops at an unconfirmed batch and retains the same operation key when recovering outcomes', () => {
    const fixture = TestBed.createComponent(RequestBatchActionsComponent);
    const component = fixture.componentInstance as any;
    component.scenes = Array.from({ length: 21 }, (_, i) => ({ id: `row-${i}`, title: 'Row' }));
    component.preview('SEARCH');
    for (const offset of [0, 20]) {
      const request = http.expectOne('/api/requests/batch/preview');
      request.flush({
        results: component.scenes
          .slice(offset, offset + 20)
          .map((row: any) => ({ ...row, eligible: true })),
      });
    }
    component.confirm();
    const first = http.expectOne('/api/requests/batch/execute');
    const key = first.request.body.operationKey;
    first.flush({ results: first.request.body.ids.map((id: string) => ({ id, ok: true })) });
    http.expectOne('/api/requests/batch/execute').flush({}, { status: 503, statusText: 'Offline' });
    expect(component.completed()).toBe(false);
    expect(component.error()).toContain('could not be confirmed');
    component.confirm();
    const retry = http.expectOne('/api/requests/batch/execute');
    expect(retry.request.body.operationKey).toBe(key);
    retry.flush({ results: retry.request.body.ids.map((id: string) => ({ id, ok: true })) });
    const last = http.expectOne('/api/requests/batch/execute');
    expect(last.request.body.operationKey).toBe(key);
    last.flush({ results: last.request.body.ids.map((id: string) => ({ id, ok: true })) });
    expect(component.completed()).toBe(true);
  });
});
