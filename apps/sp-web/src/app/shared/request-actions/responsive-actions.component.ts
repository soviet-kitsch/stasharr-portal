import {
  Component,
  Input,
  OnDestroy,
  ViewChild,
  ViewChildren,
  ElementRef,
  QueryList,
  afterNextRender,
  computed,
  signal,
} from '@angular/core';
import { Menu } from 'primeng/menu';
import { Tooltip } from 'primeng/tooltip';
import { MenuItem } from 'primeng/api';

export interface RowAction {
  key: string;
  label: string;
  icon: string;
  disabled?: boolean;
  href?: string;
  run?: () => void;
}

export function visibleActionCount(total: number, slots: number): number {
  return total <= slots ? total : Math.max(0, slots - 1);
}

@Component({
  selector: 'app-responsive-actions',
  imports: [Menu, Tooltip],
  templateUrl: './responsive-actions.component.html',
  styleUrl: './responsive-actions.component.scss',
})
export class ResponsiveActionsComponent implements OnDestroy {
  private readonly items = signal<RowAction[]>([]);
  private readonly iconOnly = signal(true);
  protected readonly slots = signal(Number.POSITIVE_INFINITY);
  @Input({ required: true }) set actions(value: RowAction[]) {
    this.items.set(value);
  }
  @Input() set compact(value: boolean) {
    this.iconOnly.set(value);
  }
  protected readonly compactView = this.iconOnly.asReadonly();
  protected readonly visible = computed(() => this.items().slice(0, this.inlineCount()));
  protected readonly hidden = computed(() => this.items().slice(this.inlineCount()));
  protected readonly menuItems = computed<MenuItem[]>(() =>
    this.hidden().map((action) => ({
      label: action.label,
      icon: action.icon,
      disabled: action.disabled,
      url: action.href,
      target: action.href ? '_blank' : undefined,
      command: action.run
        ? () => {
            this.hideTooltips();
            action.run?.();
          }
        : undefined,
    })),
  );
  private inlineCount() {
    return this.iconOnly()
      ? visibleActionCount(this.items().length, this.slots())
      : this.items().length;
  }
  @ViewChild('toolbar') private toolbar!: ElementRef<HTMLElement>;
  @ViewChild('probe') private probe!: ElementRef<HTMLElement>;
  @ViewChild('overflowTrigger') private overflowTrigger?: ElementRef<HTMLElement>;
  @ViewChild('overflow') private overflow?: Menu;
  @ViewChildren(Tooltip) private tooltips?: QueryList<Tooltip>;
  private observer?: ResizeObserver;
  constructor() {
    afterNextRender(() => {
      if (typeof ResizeObserver !== 'undefined') {
        this.observer = new ResizeObserver(() => this.measure());
        this.observer.observe(this.toolbar.nativeElement);
        this.observer.observe(this.probe.nativeElement);
      }
      this.measure();
    });
  }
  private measure() {
    const element = this.toolbar.nativeElement;
    const width = element.getBoundingClientRect().width;
    const size = this.probe.nativeElement.getBoundingClientRect().width;
    if (!width || !size) return;
    const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 0;
    const count = Math.max(1, Math.floor((width + gap + 0.1) / (size + gap)));
    if (count !== this.slots()) {
      this.overflow?.hide();
      this.slots.set(count);
    }
  }
  protected activate(action: RowAction, event: Event) {
    this.hideTooltips();
    if (action.disabled) {
      event.preventDefault();
      return;
    }
    action.run?.();
  }
  protected toggleOverflow(event: Event) {
    this.hideTooltips();
    this.overflow?.toggle(event);
  }
  private hideTooltips() {
    this.tooltips?.forEach((tooltip) => tooltip.deactivate());
  }
  protected alignOverflow() {
    const panel = this.overflow?.containerViewChild()?.nativeElement as HTMLElement | undefined;
    const target = this.overflowTrigger?.nativeElement;
    const view = target?.ownerDocument.defaultView;
    if (!panel || !target || !view) return;
    const rect = target.getBoundingClientRect();
    const width = panel.offsetWidth;
    // Keep the menu's right edge on its trigger, clamping only at viewport edges.
    const left = Math.max(8, Math.min(rect.right - width, view.innerWidth - width - 8));
    panel.style.left = `${left + view.scrollX}px`;
  }
  ngOnDestroy() {
    this.observer?.disconnect();
  }
}
