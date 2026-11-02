import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';
import { DiscoverItem, StudioDetails } from '../../core/api/discover.types';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { StudioPageComponent } from './studio-page.component';

function buildStudio(overrides: Partial<StudioDetails> = {}): StudioDetails {
  return {
    id: 'studio-1',
    name: 'Studio One',
    aliases: [],
    deleted: false,
    isFavorite: false,
    createdAt: '2026-01-01',
    updatedAt: '2026-03-01',
    imageUrl: 'http://cdn.local/studio.jpg',
    images: [],
    urls: [],
    parentStudio: null,
    childStudios: [],
    ...overrides,
  };
}

function buildScene(overrides: Partial<DiscoverItem> = {}): DiscoverItem {
  return {
    id: 'scene-1',
    title: 'Studio Scene',
    description: 'Scene description',
    imageUrl: 'http://cdn.local/scene.jpg',
    cardImageUrl: 'http://cdn.local/scene-card.jpg',
    studioId: 'studio-1',
    studio: 'Studio One',
    studioImageUrl: 'http://cdn.local/studio.jpg',
    releaseDate: '2026-03-20',
    duration: 1800,
    type: 'SCENE',
    source: 'STASHDB',
    status: { state: 'NOT_REQUESTED' },
    ...overrides,
  };
}

describe('StudioPageComponent', () => {
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
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  async function renderPage(params: Record<string, string> = {}) {
    const paramMap$ = new BehaviorSubject(convertToParamMap({ studioId: 'studio-1' }));
    const queryParamMap$ = new BehaviorSubject(convertToParamMap(params));
    const discoverService = {
      getStudioDetails: vi.fn().mockReturnValue(of(buildStudio())),
      getScenesFeed: vi.fn().mockReturnValue(
        of({
          total: 1,
          page: 1,
          perPage: 24,
          hasMore: false,
          items: [buildScene()],
        }),
      ),
      searchPerformers: vi.fn().mockReturnValue(of([])),
      searchSceneTags: vi.fn().mockReturnValue(of([])),
    };

    await TestBed.configureTestingModule({
      imports: [StudioPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: DiscoverService,
          useValue: discoverService,
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              get queryParamMap() {
                return queryParamMap$.value;
              },
            },
            paramMap: paramMap$.asObservable(),
            queryParamMap: queryParamMap$.asObservable(),
          },
        },
        {
          provide: AppNotificationsService,
          useValue: {
            success: vi.fn(),
            error: vi.fn(),
            info: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    const navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(StudioPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, discoverService, navigateSpy, queryParamMap$, paramMap$ };
  }

  it('renders studio scenes with the shared scene card and keeps request handling on the page', async () => {
    const { fixture } = await renderPage();
    const component = fixture.componentInstance as any;
    const cards = fixture.nativeElement.querySelectorAll('app-scene-card');
    const requestButton = fixture.nativeElement.querySelector(
      '.request-cta',
    ) as HTMLButtonElement | null;

    expect(cards).toHaveLength(1);
    const performerLink = fixture.nativeElement.querySelector('a[href^="/performers"]');
    expect(performerLink?.getAttribute('href')).toContain('studio=studio-1');
    expect(performerLink?.getAttribute('href')).toContain('studioName=Studio%20One');
    expect(component.requestModalOpen()).toBe(false);

    requestButton?.click();

    expect(component.requestModalOpen()).toBe(true);
    expect(component.requestContext()).toEqual({
      id: 'scene-1',
      title: 'Studio Scene',
      imageUrl: 'http://cdn.local/scene.jpg',
    });
  });
  it('combines URL performers and AND mode with the fixed studio and restores Back filters', async () => {
    const { fixture, discoverService, queryParamMap$, paramMap$ } = await renderPage({
      performers: 'p-1,p-1,p-2',
      performerNames: '["Example, Alias","Duplicate","Second"]',
      performerMode: 'AND',
      mode: 'OR',
    });
    const c = fixture.componentInstance as any;
    expect(c.selectedPerformers()).toEqual([
      { id: 'p-1', name: 'Example, Alias' },
      { id: 'p-2', name: 'Second' },
    ]);
    expect(discoverService.getScenesFeed).toHaveBeenLastCalledWith(
      1,
      24,
      'DATE',
      'DESC',
      [],
      'OR',
      undefined,
      ['studio-1'],
      ['p-1', 'p-2'],
      'AND',
    );
    queryParamMap$.next(convertToParamMap({ performers: 'p-2', performerMode: 'OR', mode: 'AND' }));
    expect(discoverService.getScenesFeed.mock.lastCall?.slice(5)).toEqual([
      'AND',
      undefined,
      ['studio-1'],
      ['p-2'],
      'OR',
    ]);
    paramMap$.next(convertToParamMap({ studioId: 'studio-2' }));
    expect(discoverService.getScenesFeed.mock.lastCall?.[7]).toEqual(['studio-2']);
  });
  it('changes matching from page one, persists labels and clears performers without losing studio scope', async () => {
    const { fixture, discoverService, navigateSpy } = await renderPage();
    const c = fixture.componentInstance as any;
    c.onPerformersChanged([
      { id: 'p-1', name: 'Example, Alias' },
      { id: 'p-2', name: 'Second' },
    ]);
    expect(navigateSpy.mock.lastCall?.[1]?.queryParams).toMatchObject({
      performers: 'p-1,p-2',
      performerNames: '["Example, Alias","Second"]',
      performerMode: null,
    });
    c.onPerformerModeChanged('AND');
    expect(discoverService.getScenesFeed.mock.lastCall?.[9]).toBe('AND');
    expect(discoverService.getScenesFeed.mock.lastCall?.[0]).toBe(1);
    c.onPerformersChanged([]);
    expect(discoverService.getScenesFeed.mock.lastCall?.[7]).toEqual(['studio-1']);
    expect(discoverService.getScenesFeed.mock.lastCall?.[8]).toEqual([]);
    expect(navigateSpy.mock.lastCall?.[1]?.queryParams.performers).toBeNull();
    c.onPerformerModeChanged('invalid');
    expect(c.selectedPerformerMode()).toBe('AND');
  });
  it('bounds URL performers and falls back safely for malformed labels and mode', async () => {
    const { fixture } = await renderPage({
      performers: Array.from({ length: 25 }, (_, i) => 'p-' + i).join(','),
      performerNames: 'invalid',
      performerMode: 'invalid',
    });
    const c = fixture.componentInstance as any;
    expect(c.selectedPerformers()).toHaveLength(20);
    expect(c.selectedPerformers()[0].name).toBe('p-0');
    expect(c.selectedPerformerMode()).toBe('OR');
  });
});
