import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ResponsiveActionsComponent,
  RowAction,
  visibleActionCount,
} from './responsive-actions.component';

describe('responsive action placement', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [ResponsiveActionsComponent] }));
  afterEach(() => TestBed.resetTestingModule());
  const actions = (count: number): RowAction[] =>
    Array.from({ length: count }, (_, i) => ({
      key: 'action-' + i,
      label: 'Action ' + i,
      icon: 'pi pi-history',
      run: vi.fn(),
    }));
  function setup(items = actions(6)) {
    const fixture = TestBed.createComponent(ResponsiveActionsComponent);
    fixture.componentRef.setInput('actions', items);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance as any, items };
  }
  it('uses every slot when all actions fit and reserves one slot only when overflow is needed', () => {
    expect(visibleActionCount(6, 6)).toBe(6);
    expect(visibleActionCount(6, 5)).toBe(4);
    expect(visibleActionCount(2, 1)).toBe(0);
    expect(visibleActionCount(0, 4)).toBe(0);
  });
  it('moves only the tail actions into overflow and removes the trigger as capabilities shrink', () => {
    const { fixture, component } = setup();
    component.slots.set(4);
    fixture.detectChanges();
    expect(component.visible().map((a: RowAction) => a.key)).toEqual([
      'action-0',
      'action-1',
      'action-2',
    ]);
    expect(component.menuItems().map((a: any) => a.label)).toEqual([
      'Action 3',
      'Action 4',
      'Action 5',
    ]);
    expect(
      fixture.nativeElement.querySelector('[aria-label="More request actions"]'),
    ).not.toBeNull();
    fixture.componentRef.setInput('actions', actions(3));
    fixture.detectChanges();
    expect(component.visible()).toHaveLength(3);
    expect(component.hidden()).toHaveLength(0);
    expect(fixture.nativeElement.querySelector('[aria-label="More request actions"]')).toBeNull();
    fixture.destroy();
  });
  it('closes an open menu when the row action set changes and everything now fits', async () => {
    const { fixture, component } = setup();
    component.slots.set(4);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[aria-label="More request actions"]').click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.overflow.visible).toBe(true);
    fixture.componentRef.setInput('actions', actions(3));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.overflow.visible).toBe(false);
    expect(fixture.nativeElement.querySelector('[aria-label="More request actions"]')).toBeNull();
    fixture.destroy();
  });
  it('dispatches the same action from inline and overflow without duplicating it', () => {
    const { fixture, component, items } = setup(actions(2));
    component.slots.set(2);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[aria-label="Action 1"]').click();
    expect(items[1].run).toHaveBeenCalledTimes(1);
    component.slots.set(1);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-label="Action 1"]')).toBeNull();
    component.menuItems()[1].command();
    expect(items[1].run).toHaveBeenCalledTimes(2);
    fixture.destroy();
  });
  it('preserves external links and disabled state in both presentations without native titles', () => {
    const { fixture, component } = setup([
      {
        key: 'link',
        label: 'Open Whisparr',
        icon: 'pi pi-external-link',
        href: 'https://example.test/movie/7',
      },
      { key: 'delete', label: 'Delete', icon: 'pi pi-trash', disabled: true, run: vi.fn() },
    ]);
    expect(fixture.nativeElement.querySelector('a').getAttribute('rel')).toContain('noopener');
    expect(fixture.nativeElement.querySelector('[aria-label="Delete"]').disabled).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('[title]')).toHaveLength(0);
    component.slots.set(1);
    fixture.detectChanges();
    expect(component.menuItems()[0]).toMatchObject({
      url: 'https://example.test/movie/7',
      target: '_blank',
    });
    expect(component.menuItems()[1].disabled).toBe(true);
    fixture.destroy();
  });
});
