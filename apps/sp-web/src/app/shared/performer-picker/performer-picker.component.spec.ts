import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';
import { PerformerPickerComponent } from './performer-picker.component';

describe('PerformerPickerComponent', () => {
  let component: any;
  let api: { getPerformersFeed: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    vi.useFakeTimers();
    api = { getPerformersFeed: vi.fn().mockReturnValue(of({ items: [] })) };
    TestBed.configureTestingModule({ providers: [{ provide: DiscoverService, useValue: api }] });
    component = TestBed.runInInjectionContext(() => new PerformerPickerComponent());
  });
  afterEach(() => {
    component.ngOnDestroy();
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('debounces searches and retains the selected chip through unrelated result pages', async () => {
    component.selected = [{ id: 'chosen', name: 'Selected performer' }];
    api.getPerformersFeed.mockReturnValue(
      of({ items: [{ id: 'new', name: 'Another performer' }] }),
    );
    component.search('A');
    component.search('Another');
    await vi.advanceTimersByTimeAsync(250);
    expect(api.getPerformersFeed).toHaveBeenCalledTimes(1);
    expect(api.getPerformersFeed).toHaveBeenCalledWith(1, 50, {
      name: 'Another',
      sort: 'NAME',
      direction: 'ASC',
    });
    expect(component.options().map((item: any) => item.id)).toEqual(['chosen', 'new']);
  });
  it('ignores stale results during the next query debounce interval', async () => {
    const old = new Subject<any>();
    api.getPerformersFeed
      .mockReturnValueOnce(old)
      .mockReturnValueOnce(of({ items: [{ id: 'fresh', name: 'Fresh' }] }));
    component.search('old');
    await vi.advanceTimersByTimeAsync(250);
    component.search('new');
    old.next({ items: [{ id: 'stale', name: 'Stale' }] });
    expect(component.options()).toEqual([]);
    await vi.advanceTimersByTimeAsync(250);
    expect(component.options()).toEqual([{ id: 'fresh', name: 'Fresh' }]);
  });
  it('keeps selections through errors, supports retry, and clears search results on close', async () => {
    component.selected = [{ id: 'selected', name: 'Selected' }];
    api.getPerformersFeed
      .mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValueOnce(of({ items: [{ id: 'retry', name: 'Retry' }] }));
    component.search('retry');
    await vi.advanceTimersByTimeAsync(250);
    expect(component.error()).toContain('Could not search');
    expect(component.options()[0].id).toBe('selected');
    component.search('retry');
    await vi.advanceTimersByTimeAsync(250);
    expect(component.error()).toBeNull();
    expect(component.options().length).toBe(2);
    component.search('');
    await vi.advanceTimersByTimeAsync(250);
    expect(component.options()).toEqual([{ id: 'selected', name: 'Selected' }]);
  });
});
