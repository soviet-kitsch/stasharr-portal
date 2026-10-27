import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { FeedStateCache } from '../navigation/feed-state-memory';
import { feedCacheInvalidationInterceptor } from './feed-cache-invalidation.interceptor';

describe('feed cache invalidation', () => {
  let http: HttpClient;
  let transport: HttpTestingController;
  let cache: FeedStateCache;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([feedCacheInvalidationInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    transport = TestBed.inject(HttpTestingController);
    cache = TestBed.inject(FeedStateCache);
    cache.save('/acquisition', {
      state: { items: ['old'], page: 1, total: 1, hasMore: false },
      scrollPosition: [0, 500],
    });
  });
  afterEach(() => {
    transport.verify();
    TestBed.resetTestingModule();
  });
  it.each([
    '/api/requests/scene/rerequest',
    '/api/requests/scene/dismiss',
    '/api/requests/scene/restore',
    '/api/scenes/studios/studio/favorite',
    '/api/integrations/WHISPARR',
    '/api/indexing/sync',
  ])('invalidates saved observations after %s', (url) => {
    http.post(url, {}).subscribe();
    transport.expectOne(url).flush({});
    expect(cache.get('/acquisition')).toBeNull();
  });
  it('invalidates even if a submission has an uncertain failed response', () => {
    http.post('/api/requests/scene/rerequest', {}).subscribe({ error: () => {} });
    transport
      .expectOne('/api/requests/scene/rerequest')
      .flush({}, { status: 502, statusText: 'Bad Gateway' });
    expect(cache.get('/acquisition')).toBeNull();
  });
  it('keeps normal read and health polling observations', () => {
    http.get('/api/scenes').subscribe();
    transport.expectOne('/api/scenes').flush({});
    http.post('/api/health/runtime/refresh', {}).subscribe();
    transport.expectOne('/api/health/runtime/refresh').flush({});
    expect(cache.get('/acquisition')).not.toBeNull();
  });
});
