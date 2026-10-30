import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RequestDiagnosticsComponent } from './request-diagnostics.component';
import { HydraSearchComponent } from './hydra-search.component';
import { HydraSettingsComponent } from './hydra-settings.component';

describe('request diagnostics controls', () => {
  let http: HttpTestingController;
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RequestDiagnosticsComponent, HydraSearchComponent, HydraSettingsComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });
  const history = { dismissed: false, activeActionId: null, actions: [] };
  const details = {
    summary: null,
    request: null,
    events: [],
    attempts: [],
    limitations: [],
    hasMoreEvents: false,
    hasMoreAttempts: false,
    whisparrUrl: null,
    sync: null,
  };
  it('does not fetch native details or start searches until explicitly opened', () => {
    const fixture = TestBed.createComponent(RequestDiagnosticsComponent);
    fixture.componentRef.setInput('sceneId', 'example');
    fixture.detectChanges();
    http.expectNone(() => true);
    (fixture.componentInstance as any).show();
    http.expectOne('/api/requests/example/diagnostics').flush(details);
    http.expectOne('/api/requests/example/history').flush(history);
    http.expectNone((r) => r.method !== 'GET');
    fixture.destroy();
  });
  it('records an explicit search with a UUID and reloads persisted outcomes', () => {
    const fixture = TestBed.createComponent(RequestDiagnosticsComponent);
    fixture.componentRef.setInput('sceneId', 'example');
    const component = fixture.componentInstance as any;
    component.show();
    http.expectOne('/api/requests/example/diagnostics').flush(details);
    http.expectOne('/api/requests/example/history').flush(history);
    component.runSearch();
    const request = http.expectOne('/api/requests/example/diagnostic-searches');
    expect(request.request.body.operationKey).toMatch(/^[a-f0-9-]{36}$/);
    request.flush({ id: 'attempt' });
    http.expectOne('/api/requests/example/diagnostics').flush(details);
    http.expectOne('/api/requests/example/history').flush(history);
    fixture.destroy();
  });
  it('retains history while loading an independent event cursor', () => {
    const fixture = TestBed.createComponent(RequestDiagnosticsComponent);
    fixture.componentRef.setInput('sceneId', 'example');
    const component = fixture.componentInstance as any;
    component.show();
    http.expectOne('/api/requests/example/history').flush(history);
    http.expectOne('/api/requests/example/diagnostics').flush({
      ...details,
      events: [{ id: 'new' }],
      nextEventCursor: 'cursor',
      hasMoreEvents: true,
    });
    component.more('events');
    const request = http.expectOne(
      (r) => r.url.endsWith('/diagnostics') && r.params.get('eventBefore') === 'cursor',
    );
    request.flush({ ...details, events: [{ id: 'old' }] });
    expect(component.data().events.map((r: any) => r.id)).toEqual(['new', 'old']);
    fixture.destroy();
  });
  it('combines structured action outcomes with events without duplicating the same final action', () => {
    const fixture = TestBed.createComponent(RequestDiagnosticsComponent);
    fixture.componentRef.setInput('sceneId', 'example');
    const component = fixture.componentInstance as any;
    const at = '2026-10-30T10:00:00.000Z';
    component.show();
    http
      .expectOne('/api/requests/example/history')
      .flush({
        ...history,
        actions: [
          {
            id: 'a',
            kind: 'RE_REQUEST',
            state: 'SUCCEEDED',
            createdAt: at,
            updatedAt: at,
            result: { message: 'Existing download reused.' },
          },
        ],
      });
    http
      .expectOne('/api/requests/example/diagnostics')
      .flush({
        ...details,
        events: [
          {
            id: 'e',
            source: 'PORTAL',
            label: 'RE REQUEST: succeeded',
            occurredAt: at,
            observedAt: at,
          },
        ],
      });
    fixture.detectChanges();
    expect(component.activity()).toHaveLength(1);
    expect(component.activity()[0].detail).toBe('Existing download reused.');
    expect(document.querySelectorAll('.p-dialog')).toHaveLength(1);
    expect(document.querySelector('.request-activity')?.textContent).toContain(
      'Existing download reused.',
    );
    expect(document.querySelector('.diagnostics-body .candidate')).toBeNull();
    fixture.destroy();
  });
  it('shows only five recent items by default and keeps technical/search details collapsed', () => {
    const fixture = TestBed.createComponent(RequestDiagnosticsComponent);
    fixture.componentRef.setInput('sceneId', 'example');
    const component = fixture.componentInstance as any;
    component.show();
    http.expectOne('/api/requests/example/history').flush(history);
    http
      .expectOne('/api/requests/example/diagnostics')
      .flush({
        ...details,
        events: Array.from({ length: 9 }, (_, i) => ({
          id: String(i),
          source: 'native',
          label: 'Event ' + i,
          occurredAt: '2026-10-30T10:00:00.000Z',
        })),
      });
    fixture.detectChanges();
    expect(document.querySelectorAll('.request-activity li')).toHaveLength(5);
    expect(
      Array.from(document.querySelectorAll<HTMLDetailsElement>('.detail-section')).every(
        (e) => !e.open,
      ),
    ).toBe(true);
    component.allActivity.set(true);
    fixture.detectChanges();
    expect(document.querySelectorAll('.request-activity li')).toHaveLength(9);
    fixture.destroy();
  });
  it('retains actionable request recovery when diagnostics are unavailable and does not replay searches', () => {
    const fixture = TestBed.createComponent(RequestDiagnosticsComponent);
    fixture.componentRef.setInput('sceneId', 'example');
    const component = fixture.componentInstance as any;
    component.show();
    http
      .expectOne('/api/requests/example/history')
      .flush({ ...history, dismissed: true, activeActionId: 'pending' });
    http
      .expectOne('/api/requests/example/diagnostics')
      .flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(document.querySelector('[aria-label="Unconfirmed request action"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Removed request"]')).not.toBeNull();
    http.expectNone((r) => r.method === 'POST');
    component.recoverRequest('outcome');
    component.recoverRequest('outcome');
    const request = http.expectOne('/api/requests/example/outcome');
    expect(request.request.body.operationKey).toBeTruthy();
    request.flush({ outcome: 'NO_PENDING_ACTION' });
    http.expectOne('/api/requests/example/history').flush(history);
    http.expectOne('/api/requests/example/diagnostics').flush(details);
    expect(component.message()).toContain('No action is awaiting an outcome');
    fixture.destroy();
  });
  it('keeps diagnostic results visible if the independent action-history request fails', () => {
    const fixture = TestBed.createComponent(RequestDiagnosticsComponent);
    fixture.componentRef.setInput('sceneId', 'example');
    const component = fixture.componentInstance as any;
    component.show();
    http
      .expectOne('/api/requests/example/history')
      .flush({}, { status: 503, statusText: 'Unavailable' });
    http
      .expectOne('/api/requests/example/diagnostics')
      .flush({
        ...details,
        summary: {
          code: 'ALL_REJECTED',
          label: 'All candidates rejected',
          detail: 'Size limit.',
          checkedAt: '2026-10-30',
        },
      });
    fixture.detectChanges();
    expect(document.querySelector('.request-summary')?.textContent).toContain(
      'All candidates rejected',
    );
    expect(component.historyError()).toBeTruthy();
    fixture.destroy();
  });
  it('keeps an edited Hydra query while changing checkboxes until regenerated', () => {
    const fixture = TestBed.createComponent(HydraSearchComponent);
    fixture.componentRef.setInput('sceneId', 'example');
    const component = fixture.componentInstance as any;
    component.show();
    http.expectOne('/api/settings/hydra-search').flush({
      browserUrl: 'https://media.test/hydra',
      studio: true,
      performers: true,
      title: false,
    });
    http
      .expectOne('/api/requests/example/hydra-terms')
      .flush({ studio: 'Studio', performers: ['Performer'], title: 'Scene' });
    expect(component.query).toBe('Studio Performer');
    component.query = 'Custom query';
    component.edited = true;
    component.choosePerformers(false);
    expect(component.query).toBe('Custom query');
    component.regenerate();
    expect(component.query).toBe('Studio');
    expect(new URL(component.link()).searchParams.get('category')).toBe('XXX');
    fixture.destroy();
  });
  it('saves only supported settings fields, preserving API whitelist validation', () => {
    const fixture = TestBed.createComponent(HydraSettingsComponent);
    fixture.detectChanges();
    http.expectOne('/api/settings/hydra-search').flush({
      id: 'default',
      browserUrl: 'https://hydra.test',
      studio: true,
      performers: true,
      title: false,
    });
    (fixture.componentInstance as any).save();
    const request = http.expectOne('/api/settings/hydra-search');
    expect(request.request.body).not.toHaveProperty('id');
    request.flush(request.request.body);
    fixture.destroy();
  });
});
