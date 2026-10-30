import {
  Component,
  EventEmitter,
  OnDestroy,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { Dialog } from 'primeng/dialog';
import { Subject, firstValueFrom, takeUntil } from 'rxjs';
import { newOperationKey } from '../../core/api/operation-key';
import { DeletionReviewComponent } from './deletion-review.component';
import { StashAvailability } from './stash-availability.component';
interface Entry {
  id: string;
  title: string;
  result?: StashAvailability;
  removed?: boolean;
  deletionProblem?: string;
}
interface EntryDeletionPreview {
  sceneId: string;
  whisparrSceneId: number | null;
  title: string | null;
  whisparrUrl: string | null;
  filesKept: true;
  previewToken: string;
  expiresAt: string;
}
interface DeletionTarget extends Entry {
  operationKey: string;
  preview?: EntryDeletionPreview;
  previewProblem?: string;
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
  imports: [Dialog, RouterLink, DeletionReviewComponent],
  styles: [
    `
      :host {
        display: inline-block;
      }
      p {
        margin: 0.2rem 0;
        overflow-wrap: anywhere;
      }
      .dialog-body {
        display: grid;
        gap: 0.7rem;
        min-width: 0;
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
        align-items: center;
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
      [header]="
        deletionReviewOpen() ? 'Delete requests and Whisparr entries?' : 'Search Stash for all'
      "
      styleClass="app-review-dialog app-stash-results-dialog"
      [visible]="open()"
      (visibleChange)="close()"
      [modal]="true"
      [closable]="!deleting()"
      [closeOnEscape]="!deleting()"
      [blockScroll]="true"
      [appendTo]="'body'"
      [style]="{ width: '42rem', maxWidth: '95vw' }"
    >
      <div class="dialog-body">
        @if (deletionReviewOpen()) {
          <p>
            Remove these requests from Portal and delete their exact Whisparr entries when present.
            Stash scenes, downloads and media files are kept. History remains available.
          </p>
          <app-deletion-review
            [items]="deletionItems()"
            [deleteFiles]="false"
            [deleteEntries]="true"
          />
          @if (previewLoading()) {
            <p role="status">Checking Whisparr entries…</p>
          }
          @if (deletionError()) {
            <p role="alert">{{ deletionError() }}</p>
          }
          @if (deleting()) {
            <p role="status">Deleting requests from Portal…</p>
          }
          <div class="app-action-row">
            @if (!deletionComplete()) {
              <button
                class="app-baseline-button"
                type="button"
                [disabled]="deleting() || previewLoading() || !readyTargets().length"
                (click)="deleteConfirmed()"
              >
                {{
                  deletionError()
                    ? 'Retry reviewed deletion'
                    : 'Delete ' +
                      readyTargets().length +
                      (readyTargets().length === 1 ? ' request' : ' requests') +
                      ' and Whisparr entries'
                }}
              </button>
            }
            <button
              class="app-baseline-button"
              type="button"
              [disabled]="deleting()"
              (click)="cancelReview()"
            >
              {{ deletionComplete() ? 'Back to results' : 'Cancel' }}
            </button>
          </div>
        } @else {
          <p>
            Check all tracked acquisitions across every page. Filters and selection do not limit
            this check.
          </p>
          <small
            >Checks only read existing Stash records. Deleting found requests also removes exact
            Whisparr entries, requires confirmation and keeps media files.</small
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
          @if (deletionPending()) {
            <button
              class="app-baseline-button"
              type="button"
              (click)="deletionReviewOpen.set(true)"
            >
              Resume deletion review
            </button>
          } @else if (removable().length) {
            <button
              class="app-baseline-button"
              type="button"
              [disabled]="running()"
              (click)="reviewDeletion(removable())"
            >
              <i class="pi pi-trash" aria-hidden="true"></i> Delete found requests ({{
                removable().length
              }})
            </button>
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
                    @if (!entry.removed && result.state === 'AVAILABLE' && result.matches.length) {
                      <button
                        class="app-baseline-button"
                        type="button"
                        [disabled]="running() || deletionPending()"
                        [attr.aria-label]="'Delete request for ' + entry.title"
                        (click)="reviewDeletion([entry])"
                      >
                        <i class="pi pi-trash" aria-hidden="true"></i> Delete request
                      </button>
                    }
                  </div>
                  @if (entry.removed) {
                    <small role="status">Removed from Portal. Files kept.</small>
                  }
                  @if (entry.deletionProblem) {
                    <p role="status">
                      {{ entry.deletionProblem }} Open the scene's Item History before starting
                      another deletion.
                    </p>
                  }
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
              <button class="app-baseline-button" type="button" (click)="stop()">
                Stop checking
              </button>
            } @else {
              <button class="app-baseline-button" type="button" (click)="show()">
                Check again
              </button>
            }
            <button class="app-baseline-button" type="button" (click)="close()">Close</button>
          </div>
        }
      </div>
    </p-dialog>
  `,
})
export class StashSearchAllComponent implements OnDestroy {
  @Output() changed = new EventEmitter<void>();
  protected readonly deletionTargets = signal<DeletionTarget[]>([]);
  protected readonly previewLoading = signal(false);
  protected readonly readyTargets = computed(() => this.deletionTargets().filter((t) => t.preview));
  protected readonly deletionReviewOpen = signal(false);
  protected readonly deleting = signal(false);
  protected readonly deletionComplete = signal(false);
  protected readonly deletionError = signal<string | null>(null);
  private destroyed = false;
  protected readonly deletionPending = computed(
    () =>
      this.deletionTargets().length > 0 &&
      this.deletionError() !== null &&
      !this.deletionComplete(),
  );
  protected readonly removable = computed(() =>
    this.entries().filter(
      (e) => e.result?.state === 'AVAILABLE' && e.result.matches.length > 0 && !e.removed,
    ),
  );
  protected readonly deletionItems = computed(() =>
    this.deletionTargets().map((target) => {
      const current = this.entries().find((e) => e.id === target.id);
      return {
        id: target.id,
        title: target.title,
        status: current?.removed
          ? 'Removed; files kept'
          : target.previewProblem
            ? 'Blocked'
            : target.preview
              ? target.preview.whisparrSceneId === null
                ? 'No Whisparr entry; Portal only'
                : 'Whisparr entry will be removed'
              : 'Checking Whisparr…',
        message: current?.deletionProblem ?? target.previewProblem,
        entryTarget: target.preview?.whisparrSceneId
          ? {
              id: target.preview.whisparrSceneId,
              title: target.preview.title ?? '',
              url: target.preview.whisparrUrl!,
            }
          : null,
      };
    }),
  );
  protected readonly open = signal(false);
  protected readonly running = signal(false);
  protected readonly collecting = signal(false);
  protected readonly entries = signal<Entry[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly page = signal(1);
  protected readonly pages = computed(() => Math.ceil(this.entries().length / 50));
  protected readonly ordered = computed(() =>
    [...this.entries()].sort(
      (a, b) => Number(b.result?.state === 'AVAILABLE') - Number(a.result?.state === 'AVAILABLE'),
    ),
  );
  protected readonly visible = computed(() =>
    this.ordered().slice((this.page() - 1) * 50, this.page() * 50),
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
    if (this.running() || this.deleting() || this.previewLoading()) return;
    if (this.deletionPending()) {
      this.open.set(true);
      this.deletionReviewOpen.set(true);
      return;
    }
    this.deletionReviewOpen.set(false);
    this.deletionTargets.set([]);
    this.deletionError.set(null);
    this.deletionComplete.set(false);
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
  protected async reviewDeletion(entries: Entry[]) {
    if (this.running() || this.deleting() || this.previewLoading()) return;
    if (this.deletionPending()) {
      this.deletionReviewOpen.set(true);
      return;
    }
    const ids = new Set(this.removable().map((e) => e.id));
    const targets: DeletionTarget[] = entries
      .filter((e) => ids.has(e.id))
      .map((e) => ({ ...e, operationKey: newOperationKey() }));
    if (!targets.length) return;
    this.deletionTargets.set(targets);
    this.deletionComplete.set(false);
    this.deletionError.set(null);
    this.deletionReviewOpen.set(true);
    this.previewLoading.set(true);
    const generation = ++this.generation;
    try {
      for (const target of targets) {
        if (this.destroyed || generation !== this.generation) return;
        try {
          const preview = await firstValueFrom(
            this.http
              .get<EntryDeletionPreview>(
                `/api/requests/${encodeURIComponent(target.id)}/whisparr-entry-deletion-preview`,
              )
              .pipe(takeUntil(this.cancel)),
          );
          if (
            preview.sceneId !== target.id ||
            preview.filesKept !== true ||
            !preview.previewToken ||
            !Number.isFinite(Date.parse(preview.expiresAt)) ||
            Date.parse(preview.expiresAt) <= Date.now() ||
            !(
              preview.whisparrSceneId === null ||
              (Number.isSafeInteger(preview.whisparrSceneId) &&
                preview.whisparrSceneId > 0 &&
                typeof preview.whisparrUrl === 'string' &&
                !!preview.whisparrUrl)
            )
          )
            throw new Error('Incomplete entry preview');
          if (generation !== this.generation) return;
          this.deletionTargets.update((rows) =>
            rows.map((t) => (t.id === target.id ? { ...t, preview } : t)),
          );
        } catch (error: any) {
          if (generation !== this.generation) return;
          const message =
            typeof error?.error?.message === 'string'
              ? error.error.message
              : 'Whisparr could not be verified. This request will be kept.';
          this.deletionTargets.update((rows) =>
            rows.map((t) => (t.id === target.id ? { ...t, previewProblem: message } : t)),
          );
        }
      }
    } finally {
      if (generation === this.generation) this.previewLoading.set(false);
    }
  }
  protected cancelReview() {
    if (this.deleting()) return;
    this.stop();
    this.deletionReviewOpen.set(false);
  }
  protected async deleteConfirmed() {
    if (
      this.deleting() ||
      this.running() ||
      this.previewLoading() ||
      this.deletionComplete() ||
      !this.readyTargets().length ||
      !this.deletionReviewOpen()
    )
      return;
    this.deleting.set(true);
    this.deletionError.set(null);
    let activeId: string | undefined;
    try {
      for (const target of this.readyTargets()) {
        if (this.destroyed) return;
        activeId = target.id;
        const result = await firstValueFrom(
          this.http
            .post<{
              outcome: string;
              whisparrSceneId: number | null;
              filesKept: boolean;
            }>(`/api/requests/${encodeURIComponent(target.id)}/delete-whisparr-entry`, {
              operationKey: target.operationKey,
              previewToken: target.preview!.previewToken,
              confirmDeleteEntry: true,
            })
            .pipe(takeUntil(this.cancel)),
        );
        if (this.destroyed) return;
        if (
          result.outcome !== 'WHISPARR_ENTRY_CLEANED' ||
          result.filesKept !== true ||
          result.whisparrSceneId !== target.preview!.whisparrSceneId
        )
          throw new Error('Incomplete deletion result');
        this.entries.update((rows) =>
          rows.map((e) =>
            e.id === target.id ? { ...e, removed: true, deletionProblem: undefined } : e,
          ),
        );
      }
      this.deletionComplete.set(true);
    } catch (error: any) {
      if (!this.destroyed) {
        if (error?.error?.actionState === 'FAILED') {
          const message =
            typeof error.error.message === 'string'
              ? error.error.message
              : 'This deletion was not sent.';
          this.entries.update((rows) =>
            rows.map((e) => (e.id === activeId ? { ...e, deletionProblem: message } : e)),
          );
          this.deletionComplete.set(true);
          this.deletionError.set(
            message + ' Remaining requests were kept. Return to results and start a fresh review.',
          );
        } else
          this.deletionError.set(
            'The result could not be confirmed. Retry this same reviewed deletion to recover recorded results, or check Item History. No retry runs automatically.',
          );
      }
    } finally {
      if (!this.destroyed) {
        this.deleting.set(false);
        this.changed.emit();
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
    this.previewLoading.set(false);
  }
  protected close() {
    if (this.deleting()) return;
    this.stop();
    this.open.set(false);
  }
  ngOnDestroy() {
    this.destroyed = true;
    this.stop();
    this.cancel.complete();
  }
}
