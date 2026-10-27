import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';
import { PerformerFeedResponse, PerformerStudioOption } from '../../core/api/discover.types';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { PerformersPageComponent } from './performers-page.component';

function feed(id = 'performer-1'): PerformerFeedResponse {
  return {
    total: 1,
    page: 1,
    perPage: 24,
    hasMore: false,
    items: [
      {
        id,
        name: 'Sample Performer',
        gender: null,
        sceneCount: 12,
        isFavorite: false,
        imageUrl: null,
        cardImageUrl: null,
      },
    ],
  };
}

describe('PerformersPageComponent discovery filters', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  async function renderPage(params: Record<string, string> = {}) {
    const queryParamMap$ = new BehaviorSubject(convertToParamMap(params));
    const route = {
      queryParamMap: queryParamMap$.asObservable(),
      snapshot: { queryParamMap: convertToParamMap(params) },
    };
    const api = {
      getPerformersFeed: vi.fn().mockReturnValue(of(feed())),
      searchPerformerStudios: vi.fn().mockReturnValue(of([])),
    };
    await TestBed.configureTestingModule({
      imports: [PerformersPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: route },
        { provide: DiscoverService, useValue: api },
        {
          provide: AppNotificationsService,
          useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
        },
      ],
    }).compileComponents();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(PerformersPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return {
      fixture,
      component: fixture.componentInstance as any,
      api,
      navigate,
      route,
      queryParamMap$,
    };
  }

  it('hydrates studio, name, sort and direction before the first globally filtered feed request', async () => {
    const { component, api, fixture } = await renderPage({
      studio: 'studio-1',
      studioName: 'Studio, Inc.',
      q: 'Sample',
      sort: 'SCENE_COUNT',
      dir: 'DESC',
    });
    expect(api.getPerformersFeed).toHaveBeenCalledTimes(1);
    expect(api.getPerformersFeed).toHaveBeenCalledWith(1, 24, {
      name: 'Sample',
      gender: undefined,
      sort: 'SCENE_COUNT',
      direction: 'DESC',
      favoritesOnly: false,
      studioId: 'studio-1',
    });
    expect(component.selectedStudio()).toEqual({ id: 'studio-1', label: 'Studio, Inc.' });
    expect(component.studioSelectOptions()[0].items[0].label).toBe('Studio, Inc.');
    expect(fixture.nativeElement.querySelector('#performers-studios')).toBeTruthy();
  });

  it('preserves a selected studio while searching and uses the exact chosen child in feed and URL', async () => {
    const { component, api, navigate } = await renderPage({
      studio: 'old',
      studioName: 'Existing Studio',
    });
    vi.useFakeTimers();
    api.searchPerformerStudios.mockReturnValue(
      of([
        { id: 'network', name: 'Network', childStudios: [{ id: 'child', name: 'Child, Studio' }] },
      ]),
    );
    component.onStudioFilterChanged('Child');
    await vi.advanceTimersByTimeAsync(260);
    expect(component.studioSelectOptions()[0].items[0]).toEqual({
      label: 'Existing Studio',
      value: 'old',
    });
    component.onStudioSelectionChanged('child');
    expect(api.getPerformersFeed.mock.lastCall?.[2].studioId).toBe('child');
    expect(navigate.mock.lastCall?.[1]?.queryParams).toMatchObject({
      studio: 'child',
      studioName: 'Child, Studio',
    });
    component.onStudioFilterChanged('');
    expect(component.studioSelectOptions()).toEqual([
      { label: 'Selected', items: [{ label: 'Child, Studio', value: 'child' }] },
    ]);
  });

  it('restores the studio selection on browser Back without an unfiltered intermediate request', async () => {
    const { component, api, route, queryParamMap$ } = await renderPage({
      studio: 'new',
      studioName: 'New Studio',
    });
    const previous = convertToParamMap({ studio: 'old', studioName: 'Old Studio' });
    route.snapshot.queryParamMap = previous;
    queryParamMap$.next(previous);
    expect(component.selectedStudioId()).toBe('old');
    expect(api.getPerformersFeed).toHaveBeenCalledTimes(2);
    expect(api.getPerformersFeed.mock.lastCall?.[2].studioId).toBe('old');
  });

  it('clears all filters and removes studio URL state', async () => {
    const { component, api, navigate, fixture } = await renderPage({
      studio: 'studio-1',
      studioName: 'Studio',
      q: 'Name',
      gender: 'FEMALE',
      sort: 'SCENE_COUNT',
      dir: 'DESC',
      fav: '1',
    });
    (fixture.nativeElement.querySelector('.reset-filters-button') as HTMLButtonElement).click();
    expect(component.hasActiveFilters()).toBe(false);
    expect(component.selectedStudio()).toBeNull();
    expect(api.getPerformersFeed.mock.lastCall?.[2]).toEqual({
      name: undefined,
      gender: undefined,
      sort: 'NAME',
      direction: 'ASC',
      favoritesOnly: false,
      studioId: undefined,
    });
    expect(navigate.mock.lastCall?.[1]?.queryParams).toMatchObject({
      studio: null,
      studioName: null,
      q: null,
    });
  });

  it('ignores a stale feed response after the studio changes and reloads the latest scope', async () => {
    const { component, api } = await renderPage();
    const oldFeed = new Subject<PerformerFeedResponse>();
    api.getPerformersFeed
      .mockReturnValueOnce(oldFeed)
      .mockReturnValueOnce(of(feed('new-performer')));
    component.onStudioSelectionChanged('old');
    component.onStudioSelectionChanged('new');
    oldFeed.next(feed('stale-performer'));
    expect(component.items()).toEqual([]);
    oldFeed.complete();
    expect(api.getPerformersFeed.mock.lastCall?.[2].studioId).toBe('new');
    expect(component.items()[0].id).toBe('new-performer');
  });

  it('cancels old studio search immediately when typing a new query and retains selection after search errors', async () => {
    const { component, api } = await renderPage({
      studio: 'selected',
      studioName: 'Selected Studio',
    });
    vi.useFakeTimers();
    const oldSearch = new Subject<PerformerStudioOption[]>();
    api.searchPerformerStudios
      .mockReturnValueOnce(oldSearch)
      .mockReturnValueOnce(throwError(() => new Error('offline')));
    component.onStudioFilterChanged('old');
    await vi.advanceTimersByTimeAsync(260);
    component.onStudioFilterChanged('new');
    oldSearch.next([{ id: 'stale', name: 'Stale Studio', childStudios: [] }]);
    expect(component.studioOptions()).toEqual([]);
    await vi.advanceTimersByTimeAsync(260);
    expect(component.studioSearchError()).toContain('Failed to load');
    expect(component.selectedStudioId()).toBe('selected');
    expect(component.studioSelectOptions()[0].items[0].value).toBe('selected');
    expect(component.studioSearchLoading()).toBe(false);
  });

  it('offers actual provider popularity with its basis and defaults selection to descending', async () => {
    const { component, api, fixture } = await renderPage();
    component.onSortChanged('POPULARITY');
    fixture.detectChanges();
    expect(api.getPerformersFeed.mock.lastCall?.[2]).toMatchObject({
      sort: 'POPULARITY',
      direction: 'DESC',
    });
    expect(fixture.nativeElement.textContent).toContain(
      'Based on community fingerprint submissions.',
    );
    expect(
      component.sortOptions.find((option: { value: string }) => option.value === 'SCENE_COUNT')
        .label,
    ).toBe('Scene Count');
  });
});
