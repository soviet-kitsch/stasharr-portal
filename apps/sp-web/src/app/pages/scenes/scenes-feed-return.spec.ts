import { ViewportScroller } from '@angular/common';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withInMemoryScrolling } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';
import { RuntimeHealthService } from '../../core/api/runtime-health.service';
import { SetupStatusStore } from '../../core/api/setup-status.store';
import {
  FeedStateCache,
  RESTORE_FEED_NAVIGATION_STATE,
} from '../../core/navigation/feed-state-memory';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { ScenesPageComponent } from './scenes-page.component';

@Component({ template: '<p>Detail fixture</p>' })
class DetailFixture {}

describe('Scenes feed return navigation', () => {
  beforeEach(() =>
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    ),
  );
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  it('restores loaded pages with performer/studio filters, while fresh and invalidated visits reload', async () => {
    const api = {
      getScenesFeed: vi.fn((page: number) =>
        of({
          total: 60,
          page,
          perPage: 24,
          hasMore: true,
          items: [
            {
              id: `scene-${page}`,
              title: `Scene ${page}`,
              description: null,
              imageUrl: null,
              cardImageUrl: null,
              studioId: 'studio-1',
              studio: 'Example studio',
              studioImageUrl: null,
              releaseDate: null,
              duration: null,
              type: 'SCENE',
              source: 'STASHDB',
              status: { state: 'NOT_REQUESTED' },
              requestable: true,
            },
          ],
        }),
      ),
      searchSceneTags: vi.fn(() => of([])),
      searchPerformerStudios: vi.fn(() => of([])),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            { path: 'scenes', component: ScenesPageComponent },
            { path: 'detail', component: DetailFixture },
          ],
          withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
        ),
        { provide: DiscoverService, useValue: api },
        {
          provide: RuntimeHealthService,
          useValue: { ensureStarted: vi.fn(), status: signal(null) },
        },
        {
          provide: SetupStatusStore,
          useValue: {
            status: signal({
              setupComplete: true,
              required: { stash: true, catalog: true, whisparr: true },
              catalogProvider: 'STASHDB',
            }),
          },
        },
        {
          provide: AppNotificationsService,
          useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
        },
        {
          provide: ViewportScroller,
          useValue: {
            getScrollPosition: () => [0, 800],
            scrollToPosition: vi.fn(),
            scrollToAnchor: vi.fn(),
            setHistoryScrollRestoration: vi.fn(),
            setOffset: vi.fn(),
          },
        },
      ],
    });
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    const url = '/scenes?performers=p-1&performerNames=%5B%22Example%22%5D&studios=studio-1';
    const first: any = await harness.navigateByUrl(url, ScenesPageComponent);
    first.loadNextPage();
    expect(first.page()).toBe(2);
    expect(api.getScenesFeed).toHaveBeenCalledTimes(2);
    await harness.navigateByUrl('/detail');
    await router.navigateByUrl(url, { state: RESTORE_FEED_NAVIGATION_STATE });
    await harness.fixture.whenStable();
    const restored = harness.routeDebugElement?.componentInstance as any;
    expect(restored.page()).toBe(2);
    expect(restored.items().map((item: { id: string }) => item.id)).toEqual(['scene-1', 'scene-2']);
    expect(restored.selectedPerformers()).toEqual([{ id: 'p-1', name: 'Example' }]);
    expect(api.getScenesFeed).toHaveBeenCalledTimes(2);
    await harness.navigateByUrl('/detail');
    TestBed.inject(FeedStateCache).invalidateAll();
    await router.navigateByUrl(url, { state: RESTORE_FEED_NAVIGATION_STATE });
    await harness.fixture.whenStable();
    expect((harness.routeDebugElement?.componentInstance as any).page()).toBe(1);
    expect(api.getScenesFeed).toHaveBeenCalledTimes(3);
    await harness.navigateByUrl('/detail');
    await harness.navigateByUrl(url);
    expect(api.getScenesFeed).toHaveBeenCalledTimes(4);
  });
});
