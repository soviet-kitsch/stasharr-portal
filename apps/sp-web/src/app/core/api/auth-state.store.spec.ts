import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { FeedStateCache } from '../navigation/feed-state-memory';
import { AuthStateStore } from './auth-state.store';

describe('auth boundary feed memory', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('clears remembered media after logout, expired sessions and account changes', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const store = TestBed.inject(AuthStateStore);
    const cache = TestBed.inject(FeedStateCache);
    store.sync({ authenticated: true, username: 'first', bootstrapRequired: false });
    const save = () =>
      cache.save('/library', {
        state: { items: ['private'], page: 1, total: 1, hasMore: false },
        scrollPosition: [0, 100],
      });
    save();
    store.sync({ authenticated: true, username: 'first', bootstrapRequired: false });
    expect(cache.get('/library')).not.toBeNull();
    store.sync({ authenticated: true, username: 'other', bootstrapRequired: false });
    expect(cache.get('/library')).toBeNull();
    save();
    store.sync({ authenticated: false, username: null, bootstrapRequired: false });
    expect(cache.get('/library')).toBeNull();
    save();
    store.clear();
    expect(cache.get('/library')).toBeNull();
  });
});
