import { Component, Input, Output, EventEmitter, OnDestroy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MultiSelect } from 'primeng/multiselect';
import {
  Observable,
  Subject,
  Subscription,
  catchError,
  debounceTime,
  of,
  switchMap,
  tap,
} from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';

export interface PerformerSelection {
  id: string;
  name: string;
}

@Component({
  selector: 'app-performer-picker',
  imports: [FormsModule, MultiSelect],
  template: `
    <p-multiselect
      inputId="scenes-performers"
      ariaLabel="Performers in scene"
      [ngModel]="selected.map(idOf)"
      (ngModelChange)="select($event)"
      [options]="options()"
      optionLabel="name"
      optionValue="id"
      [filter]="true"
      (onFilter)="search($event.filter ?? '')"
      (onPanelHide)="search('')"
      [resetFilterOnHide]="true"
      filterPlaceHolder="Search performer names"
      placeholder="Choose performers"
      [showToggleAll]="false"
      [selectionLimit]="20"
      display="chip"
      [fluid]="true"
      [loading]="loading()"
      [emptyMessage]="message()"
      [emptyFilterMessage]="message()"
      [appendTo]="'body'"
      panelStyleClass="app-overlay-panel"
      scrollHeight="16rem"
    />
    @if (error()) {
      <small role="status">{{ error() }}</small>
    }
  `,
})
export class PerformerPickerComponent implements OnDestroy {
  private readonly api = inject(DiscoverService);
  private readonly terms = new Subject<string>();
  private version = 0;
  private current: PerformerSelection[] = [];
  private results: PerformerSelection[] = [];
  private term = '';
  protected readonly idOf = (item: PerformerSelection) => item.id;
  protected readonly options = signal<PerformerSelection[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  @Input() set selected(value: PerformerSelection[]) {
    this.current = value;
    this.rebuild();
  }
  get selected(): PerformerSelection[] {
    return this.current;
  }
  @Output() selectionChange = new EventEmitter<PerformerSelection[]>();
  private readonly subscription: Subscription = this.terms
    .pipe(
      // Invalidate immediately, including the debounce interval before the next request.
      tap(() => {
        this.version++;
        this.loading.set(false);
        this.error.set(null);
      }),
      debounceTime(250),
      switchMap((name) => {
        const version = this.version;
        this.loading.set(!!name);
        const response$: Observable<{ items: PerformerSelection[] }> = name
          ? this.api.getPerformersFeed(1, 50, { name, sort: 'NAME', direction: 'ASC' })
          : of({ items: [] });
        return response$.pipe(
          catchError(() => {
            if (version === this.version) this.error.set('Could not search performers. Try again.');
            return of({ items: [] });
          }),
          tap((response) => {
            if (version !== this.version) return;
            this.loading.set(false);
            this.results = response.items;
            this.rebuild();
          }),
        );
      }),
    )
    .subscribe();
  protected search(value: string): void {
    this.term = value.trim();
    this.terms.next(this.term);
  }
  protected select(ids: string[] | null): void {
    const byId = new Map(this.options().map((item) => [item.id, item]));
    this.selectionChange.emit(
      [...new Set(ids ?? [])]
        .slice(0, 20)
        .map((id) => byId.get(id))
        .filter((item): item is PerformerSelection => !!item),
    );
  }
  protected message(): string {
    return this.error() ?? (this.term ? 'No matching performers.' : 'Type to search performers.');
  }
  private rebuild(): void {
    this.options.set([
      ...new Map([...this.current, ...this.results].map((item) => [item.id, item])).values(),
    ]);
  }
  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }
}
