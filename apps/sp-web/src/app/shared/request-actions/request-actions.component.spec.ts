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
        { provide: AppNotificationsService, useValue: { success: vi.fn() } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  function button(fixture: { nativeElement: HTMLElement }, label: string): HTMLButtonElement {
    const result = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (item) => item.textContent?.trim() === label,
    );
    if (!result) throw new Error('Missing button: ' + label);
    return result;
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
    expect(fixture.nativeElement.textContent).toContain(
      'downloads and media files remain unchanged',
    );
    const changed = vi.spyOn(fixture.componentInstance.changed, 'emit');
    button(fixture, 'Delete from Portal').click();
    const request = http.expectOne('/api/requests/scene-1/dismiss');
    expect(request.request.body.operationKey).toBeTruthy();
    request.flush({ outcome: 'DISMISSED' });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('prevents repeated search clicks while the first action is in flight', () => {
    const fixture = single();
    button(fixture, 'Search again').click();
    button(fixture, 'Search again').click();
    http.expectOne('/api/requests/scene-1/search').flush({ outcome: 'ALREADY_QUEUED' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Already in the download queue.');
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
    expect(fixture.nativeElement.textContent).toContain('Completed');
  });

  it('requires legacy settings to be chosen and can collect batch settings without submitting a scene', async () => {
    const fixture = TestBed.createComponent(SceneRequestModalComponent);
    fixture.componentRef.setInput('sceneId', 'scene-1');
    fixture.componentRef.setInput('settingsOnly', true);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    http.expectOne('/api/requests/scene-1/options').flush({
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
});
