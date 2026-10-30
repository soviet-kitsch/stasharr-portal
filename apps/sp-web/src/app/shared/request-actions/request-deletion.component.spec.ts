import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { RequestDeletionComponent } from './request-deletion.component';
const preview = {
  whisparrSceneId: 42,
  title: 'Synthetic scene',
  folder: '/library/synthetic',
  files: [{ id: 1, path: '/library/synthetic/video.mp4', size: 123 }],
  previewToken: 'signed-preview',
  expiresAt: '2099-01-01T00:00:00Z',
  whisparrUrl: 'http://whisparr.invalid/movie/42',
  recovery: 'Deletion may be permanent.',
};
describe('optional Whisparr file deletion', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RequestDeletionComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });
  function setup() {
    const fixture = TestBed.createComponent(RequestDeletionComponent);
    fixture.componentRef.setInput('sceneId', 'scene-1');
    fixture.componentRef.setInput('sceneTitle', 'Synthetic scene');
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance as any };
  }
  it('defaults to Portal only without even fetching Whisparr evidence', () => {
    const { component } = setup();
    expect(component.deleteFiles()).toBe(false);
    http.expectNone(() => true);
    component.submit();
    const request = http.expectOne('/api/requests/scene-1/dismiss');
    expect(Object.keys(request.request.body)).toEqual(['operationKey']);
    request.flush({ outcome: 'DISMISSED' });
  });
  it('requires opt-in, a preview, and separate acknowledgment before sending the exact approved token', () => {
    const { component } = setup();
    component.chooseFiles(true);
    component.submit();
    http.expectNone((r) => r.method === 'POST');
    http.expectOne('/api/requests/scene-1/whisparr-deletion-preview').flush(preview);
    component.submit();
    http.expectNone((r) => r.method === 'POST');
    component.acknowledged.set(true);
    component.submit();
    const request = http.expectOne('/api/requests/scene-1/delete-whisparr');
    expect(request.request.body).toEqual({
      operationKey: expect.any(String),
      previewToken: 'signed-preview',
      confirmDeleteFiles: true,
    });
    request.flush({ message: 'Scene removed; cleanup requested.' });
  });
  it('ignores late preview responses after opting out', () => {
    const { component } = setup();
    component.chooseFiles(true);
    const request = http.expectOne('/api/requests/scene-1/whisparr-deletion-preview');
    component.chooseFiles(false);
    request.flush(preview);
    expect(component.preview()).toBeNull();
    expect(component.acknowledged()).toBe(false);
  });
  it('ignores late preview responses after switching scenes', () => {
    const { fixture, component } = setup();
    component.chooseFiles(true);
    const request = http.expectOne('/api/requests/scene-1/whisparr-deletion-preview');
    fixture.componentRef.setInput('sceneId', 'scene-2');
    fixture.detectChanges();
    request.flush(preview);
    expect(component.preview()).toBeNull();
    expect(component.deleteFiles()).toBe(false);
  });
  it('never resends after an unknown response and opens history only after the dialog closes', () => {
    const { component } = setup();
    component.chooseFiles(true);
    http.expectOne('/api/requests/scene-1/whisparr-deletion-preview').flush(preview);
    component.acknowledged.set(true);
    component.submit();
    http
      .expectOne('/api/requests/scene-1/delete-whisparr')
      .flush({}, { status: 409, statusText: 'Conflict' });
    expect(component.uncertain()).toBe(true);
    component.submit();
    http.expectNone((r) => r.method === 'POST');
    const history = vi.spyOn(component.needsOutcome, 'emit');
    component.checkOutcome();
    expect(history).not.toHaveBeenCalled();
    component.afterHide();
    expect(history).toHaveBeenCalledOnce();
  });
  it('requires a fresh review after a safe pre-dispatch failure', () => {
    const { component } = setup();
    component.chooseFiles(true);
    http.expectOne('/api/requests/scene-1/whisparr-deletion-preview').flush(preview);
    component.acknowledged.set(true);
    component.submit();
    http
      .expectOne('/api/requests/scene-1/delete-whisparr')
      .flush(
        { actionState: 'FAILED', message: 'Files changed' },
        { status: 409, statusText: 'Conflict' },
      );
    expect(component.uncertain()).toBe(false);
    expect(component.preview()).toBeNull();
    expect(component.acknowledged()).toBe(false);
    component.submit();
    http.expectNone((r) => r.method === 'POST');
  });
  it('rejects an expired preview without sending', () => {
    const { component } = setup();
    component.chooseFiles(true);
    http
      .expectOne('/api/requests/scene-1/whisparr-deletion-preview')
      .flush({ ...preview, expiresAt: '2000-01-01' });
    component.acknowledged.set(true);
    component.submit();
    http.expectNone((r) => r.method === 'POST');
    expect(component.error()).toContain('expired');
  });
  it('clears opt-in and review when reopened', () => {
    const { fixture, component } = setup();
    component.chooseFiles(true);
    http.expectOne('/api/requests/scene-1/whisparr-deletion-preview').flush(preview);
    component.acknowledged.set(true);
    fixture.componentRef.setInput('open', false);
    fixture.detectChanges();
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    expect(component.deleteFiles()).toBe(false);
    expect(component.preview()).toBeNull();
    expect(component.acknowledged()).toBe(false);
  });
});
