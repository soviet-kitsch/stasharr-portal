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
    http.expectNone((r) => r.method !== 'GET');
    fixture.destroy();
  });
  it('records an explicit search with a UUID and reloads persisted outcomes', () => {
    const fixture = TestBed.createComponent(RequestDiagnosticsComponent);
    fixture.componentRef.setInput('sceneId', 'example');
    const component = fixture.componentInstance as any;
    component.show();
    http.expectOne('/api/requests/example/diagnostics').flush(details);
    component.runSearch();
    const request = http.expectOne('/api/requests/example/diagnostic-searches');
    expect(request.request.body.operationKey).toMatch(/^[a-f0-9-]{36}$/);
    request.flush({ id: 'attempt' });
    http.expectOne('/api/requests/example/diagnostics').flush(details);
    fixture.destroy();
  });
  it('retains history while loading an independent event cursor', () => {
    const fixture = TestBed.createComponent(RequestDiagnosticsComponent);
    fixture.componentRef.setInput('sceneId', 'example');
    const component = fixture.componentInstance as any;
    component.show();
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
