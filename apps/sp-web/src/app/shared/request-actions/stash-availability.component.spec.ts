import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { StashAvailabilityComponent } from './stash-availability.component';
const result = {
  state: 'AVAILABLE',
  summary: 'A matching file is listed.',
  checkedAt: '2026-10-30T10:00:00Z',
  libraryUrl: 'https://media.example/stash/scenes',
  limitation: 'Records only, not filesystem readability.',
  matches: [
    {
      id: '1',
      label: 'Stash scene 1',
      viewUrl: 'https://media.example/stash/scenes/1',
      evidence: 'CATALOG_ID',
    },
  ],
};
describe('Stash availability dialog', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [StashAvailabilityComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });
  function setup() {
    const fixture = TestBed.createComponent(StashAvailabilityComponent);
    fixture.componentRef.setInput('sceneId', 'scene-1');
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance as any };
  }
  it('does no background reads and issues only one fresh GET when explicitly opened', () => {
    const { component } = setup();
    http.expectNone(() => true);
    component.show();
    component.check();
    http.expectOne('/api/acquisition/scenes/scene-1/stash-availability').flush(result);
    expect(component.result().state).toBe('AVAILABLE');
    component.check();
    http
      .expectOne('/api/acquisition/scenes/scene-1/stash-availability')
      .flush({ ...result, state: 'NOT_FOUND', matches: [] });
    expect(component.result().state).toBe('NOT_FOUND');
    http.expectNone((r) => r.method !== 'GET');
  });
  it('renders a direct scene link and distinguishes an unavailable response from absence', async () => {
    const { fixture, component } = setup();
    component.show();
    http.expectOne('/api/acquisition/scenes/scene-1/stash-availability').flush(result);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.querySelector<HTMLAnchorElement>('.app-review-dialog a')?.href).toBe(
      result.matches[0].viewUrl,
    );
    component.check();
    http
      .expectOne('/api/acquisition/scenes/scene-1/stash-availability')
      .flush({ ...result, state: 'UNAVAILABLE', matches: [] });
    fixture.detectChanges();
    expect(document.querySelector('.app-review-dialog')?.textContent).toContain('Couldn’t verify');
  });
  it('cancels a previous scene lookup on scene changes', () => {
    const { fixture, component } = setup();
    component.show();
    const request = http.expectOne('/api/acquisition/scenes/scene-1/stash-availability');
    fixture.componentRef.setInput('sceneId', 'scene-2');
    fixture.detectChanges();
    expect(request.cancelled).toBe(true);
    expect(component.open()).toBe(false);
    expect(component.result()).toBeNull();
  });
  it('shows a retryable error without retaining an old positive result', () => {
    const { component } = setup();
    component.show();
    http.expectOne('/api/acquisition/scenes/scene-1/stash-availability').flush(result);
    component.check();
    http
      .expectOne('/api/acquisition/scenes/scene-1/stash-availability')
      .flush({}, { status: 503, statusText: 'Offline' });
    expect(component.result()).toBeNull();
    expect(component.error()).toContain('could not be checked');
  });
});
