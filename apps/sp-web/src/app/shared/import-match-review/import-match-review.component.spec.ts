import { SimpleChange } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { ImportMatchReviewComponent } from './import-match-review.component';

describe('ImportMatchReviewComponent', () => {
  let api: any;
  let component: any;
  beforeEach(() => {
    api = {
      post: vi
        .fn()
        .mockReturnValue(
          of({
            sceneId: 'one',
            portalStatus: 'AVAILABLE',
            reconciliationMessage: 'Available',
            candidates: [],
            nextSteps: [],
            limitations: [],
          }),
        ),
      get: vi
        .fn()
        .mockReturnValue(of({ sceneId: 'one', candidates: [], nextSteps: [], limitations: [] })),
    };
    TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: api }] });
    component = TestBed.runInInjectionContext(() => new ImportMatchReviewComponent());
    component.sceneId = 'one';
  });
  afterEach(() => {
    component.ngOnDestroy();
    TestBed.resetTestingModule();
  });
  it('does not inspect every queue row until the user opens its review', () => {
    expect(api.get).not.toHaveBeenCalled();
    component.show();
    expect(api.get).toHaveBeenCalledWith('/api/acquisition/scenes/one/match-review');
    expect(component.review().sceneId).toBe('one');
  });
  it('cancels an obsolete result when the scene changes', () => {
    const old = new Subject<any>();
    api.get.mockReturnValue(old);
    component.show();
    component.sceneId = 'two';
    component.ngOnChanges({ sceneId: new SimpleChange('one', 'two', false) });
    old.next({ sceneId: 'one' });
    expect(component.review()).toBeNull();
    expect(component.open()).toBe(false);
  });
  it('reports a lookup error as unverified and supports re-checking', () => {
    api.get.mockReturnValueOnce(throwError(() => new Error('provider failure')));
    component.show();
    expect(component.error()).toContain('could not be loaded');
    expect(component.loading()).toBe(false);
    component.load();
    expect(component.error()).toBeNull();
    expect(component.review().sceneId).toBe('one');
  });
  it('refreshes the scene only on explicit action and updates the parent when the review closes', () => {
    const changed = vi.spyOn(component.reconciled, 'emit');
    component.show();
    expect(api.post).not.toHaveBeenCalled();
    component.reconcile();
    expect(api.post).toHaveBeenCalledWith('/api/acquisition/scenes/one/reconcile', {});
    expect(component.review().portalStatus).toBe('AVAILABLE');
    expect(changed).not.toHaveBeenCalled();
    component.setOpen(false);
    expect(changed).toHaveBeenCalledOnce();
  });
  it('blocks duplicate refreshes and keeps failures visible without claiming recovery', () => {
    const response = new Subject();
    api.post.mockReturnValue(response);
    component.reconcile();
    component.reconcile();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(component.reconciling()).toBe(true);
    response.error(new Error('offline'));
    expect(component.reconciling()).toBe(false);
    expect(component.error()).toContain('could not be confirmed');
  });
});
