import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { DiscoverService } from './discover.service';
describe('scene performer match mode transport', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });
  it.each(['AND', 'OR'] as const)('sends %s independently of tag matching', (mode) => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    TestBed.inject(DiscoverService)
      .getScenesFeed(2, 24, 'DATE', 'DESC', ['tag'], 'AND', undefined, ['studio'], ['a', 'b'], mode)
      .subscribe();
    const r = TestBed.inject(HttpTestingController).expectOne((r) => r.url === '/api/scenes');
    expect(r.request.params.get('performerMode')).toBe(mode);
    expect(r.request.params.get('performerIds')).toBe('a,b');
    expect(r.request.params.get('tagMode')).toBe('AND');
    expect(r.request.params.get('page')).toBe('2');
    r.flush({ items: [] });
  });
});
