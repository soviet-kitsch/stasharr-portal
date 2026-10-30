import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { Dialog } from 'primeng/dialog';
import { Subject, firstValueFrom, takeUntil } from 'rxjs';
import { StashAvailability } from './stash-availability.component';
interface Entry {
  id: string;
  title: string;
  result?: StashAvailability;
}
interface Snapshot {
  items: { id: string; title: string }[];
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  selectionVersion: string;
}
@Component({
  selector: 'app-stash-search-all',
  imports: [Dialog, RouterLink],
  styles: [
    `
      :host {
        display: inline-block;
      }
      p {
        margin: 0.2rem 0;
        overflow-wrap: anywhere;
      }
      .results {
        max-height: min(45vh, 23rem);
        overflow: auto;
      }
      article {
        padding: 0.55rem 0;
        border-bottom: 1px solid var(--p-content-border-color);
        overflow-wrap: anywhere;
      }
      .result-head {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 0.4rem;
      }
      .copies {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-top: 0.35rem;
      }
      small {
        color: var(--text-muted);
      }
    `,
  ],
  template: `
    <button class="app-baseline-button" type="button" [disabled]="running()" (click)="show()">
      <i class="pi pi-database" aria-hidden="true"></i> Search Stash for all
    </button>
    <p-dialog
      header="Search Stash for all"
      styleClass="app-review-dialog"
      [visible]="open()"
      (visibleChange)="close()"
      [modal]="true"
      [blockScroll]="true"
      [appendTo]="'body'"
      [style]="{ width: '42rem', maxWidth: '95vw' }"
    >
      <p>
        Check all tracked acquisitions across every page. Filters and selection do not limit this
        check.
      </p>
      <small
        >Reads existing Stash records; does not download, scan, identify or change request
        status.</small
      >
      @if (collecting()) {
        <p role="status">Gathering tracked scenes…</p>
      }
      @if (entries().length) {
        <p role="status">
          {{ checked() }} of {{ entries().length }} checked · {{ available() }} available ·
          {{ notFound() }} no match · {{ unknown() }} unverified
        </p>
      }
      @if (error()) {
        <p role="alert">{{ error() }}</p>
      }
      <div class="results" tabindex="0" aria-label="Stash availability results">
        @for (entry of visible(); track entry.id) {
          <article>
            <div class="result-head">
              <a [routerLink]="['/scene', entry.id]" (click)="close()">{{ entry.title }}</a
              ><strong>{{ label(entry) }}</strong>
            </div>
            @if (entry.result; as result) {
              <small>{{ result.summary }}</small>
              <div class="copies">
                @for (copy of result.matches; track copy.id) {
                  <a [href]="copy.viewUrl" target="_blank" rel="noopener noreferrer"
                    >Open {{ copy.label }}</a
                  >
                }
              </div>
            }
          </article>
        }
      </div>
      @if (pages() > 1) {
        <div class="app-action-row">
          <button
            class="app-baseline-button"
            type="button"
            [disabled]="page() === 1"
            (click)="page.set(page() - 1)"
          >
            Previous</button
          ><span>Page {{ page() }} of {{ pages() }}</span
          ><button
            class="app-baseline-button"
            type="button"
            [disabled]="page() === pages()"
            (click)="page.set(page() + 1)"
          >
            Next
          </button>
        </div>
      }
      <div class="app-action-row">
        @if (running()) {
          <button class="app-baseline-button" type="button" (click)="stop()">Stop checking</button>
        } @else {
          <button class="app-baseline-button" type="button" (click)="show()">Check again</button>
        }
        <button class="app-baseline-button" type="button" (click)="close()">Close</button>
      </div>
    </p-dialog>
  `,
})
export class StashSearchAllComponent implements OnDestroy {
  protected readonly open = signal(false);
  protected readonly running = signal(false);
  protected readonly collecting = signal(false);
  protected readonly entries = signal<Entry[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly page = signal(1);
  protected readonly pages = computed(() => Math.ceil(this.entries().length / 50));
  protected readonly visible = computed(() =>
    this.entries().slice((this.page() - 1) * 50, this.page() * 50),
  );
  protected readonly checked = computed(() => this.entries().filter((e) => e.result).length);
  protected readonly available = computed(
    () => this.entries().filter((e) => e.result?.state === 'AVAILABLE').length,
  );
  protected readonly notFound = computed(
    () => this.entries().filter((e) => e.result?.state === 'NOT_FOUND').length,
  );
  protected readonly unknown = computed(
    () =>
      this.entries().filter((e) => e.result && !['AVAILABLE', 'NOT_FOUND'].includes(e.result.state))
        .length,
  );
  private readonly http = inject(HttpClient);
  private readonly cancel = new Subject<void>();
  private generation = 0;
  async show() {
    if (this.running()) return;
    const generation = ++this.generation;
    this.open.set(true);
    this.running.set(true);
    this.collecting.set(true);
    this.entries.set([]);
    this.error.set(null);
    this.page.set(1);
    try {
      const entries = new Map<string, Entry>();
      let version: string | undefined;
      let total = 0;
      for (let page = 1; page <= 200; page++) {
        const params = new HttpParams()
          .set('page', page)
          .set('perPage', 50)
          .set('lifecycle', 'ANY')
          .set('sort', 'OLDEST');
        const snapshot = await firstValueFrom(
          this.http
            .get<Snapshot>('/api/acquisition/table', { params })
            .pipe(takeUntil(this.cancel)),
        );
        if (generation !== this.generation) return;
        if (
          !Number.isSafeInteger(snapshot.total) ||
          snapshot.total < 0 ||
          snapshot.total > 10000 ||
          snapshot.page !== page ||
          snapshot.perPage !== 50 ||
          !snapshot.selectionVersion ||
          (version && version !== snapshot.selectionVersion) ||
          !Array.isArray(snapshot.items) ||
          snapshot.items.length !== Math.min(50, Math.max(0, snapshot.total - (page - 1) * 50)) ||
          snapshot.hasMore !== page * 50 < snapshot.total
        )
          throw new Error('Incomplete or changed snapshot');
        version = snapshot.selectionVersion;
        total = snapshot.total;
        for (const entry of snapshot.items) {
          if (!entry.id || typeof entry.id !== 'string' || entries.has(entry.id))
            throw new Error('Invalid snapshot identities');
          entries.set(entry.id, { id: entry.id, title: entry.title || entry.id });
        }
        if (!snapshot.hasMore) break;
      }
      if (entries.size !== total) throw new Error('Incomplete snapshot');
      this.entries.set([...entries.values()]);
      this.collecting.set(false);
      if (!total) this.error.set('No tracked acquisitions to check.');
      for (const entry of entries.values()) {
        if (generation !== this.generation) return;
        let result: StashAvailability;
        try {
          result = await firstValueFrom(
            this.http
              .get<StashAvailability>(
                `/api/acquisition/scenes/${encodeURIComponent(entry.id)}/stash-availability`,
              )
              .pipe(takeUntil(this.cancel)),
          );
          if (
            !['AVAILABLE', 'NOT_FOUND', 'UNAVAILABLE', 'NOT_CONFIGURED'].includes(result.state) ||
            !Array.isArray(result.matches)
          )
            throw new Error('Invalid availability response');
        } catch {
          if (generation !== this.generation) return;
          result = {
            state: 'UNAVAILABLE',
            summary: 'The lookup could not be completed. Availability is unknown.',
            matches: [],
            checkedAt: new Date().toISOString(),
            libraryUrl: null,
            limitation: '',
          };
        }
        if (generation !== this.generation) return;
        this.entries.update((rows) => rows.map((e) => (e.id === entry.id ? { ...e, result } : e)));
      }
    } catch {
      if (generation === this.generation)
        this.error.set(
          'The tracked list changed or could not be loaded completely. No Stash checks were started. Please retry.',
        );
    } finally {
      if (generation === this.generation) {
        this.running.set(false);
        this.collecting.set(false);
      }
    }
  }
  protected label(entry: Entry) {
    return entry.result
      ? (
          {
            AVAILABLE: 'Available in Stash',
            NOT_FOUND: 'No match found',
            UNAVAILABLE: 'Couldn’t verify',
            NOT_CONFIGURED: 'Setup needed',
          } as Record<string, string>
        )[entry.result.state]
      : this.running()
        ? 'Waiting'
        : 'Not checked';
  }
  protected stop() {
    this.generation++;
    this.cancel.next();
    this.running.set(false);
    this.collecting.set(false);
  }
  protected close() {
    this.stop();
    this.open.set(false);
  }
  ngOnDestroy() {
    this.stop();
    this.cancel.complete();
  }
}
