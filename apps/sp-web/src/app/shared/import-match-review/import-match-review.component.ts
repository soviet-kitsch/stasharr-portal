import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core';
import { Subscription, finalize } from 'rxjs';
import { Dialog } from 'primeng/dialog';

export interface ImportMatchReview {
  sceneId: string;
  checkedAt: string;
  snapshotAt: string | null;
  condition: string;
  summary: string;
  whisparr: {
    state: string;
    hasFile: boolean | null;
    filePath: string | null;
    fileSize: number | null;
    viewUrl: string | null;
  };
  stash: { state: string; viewUrl: string | null; candidatesTruncated: boolean };
  candidates: {
    id: string;
    title: string;
    viewUrl: string | null;
    evidence: string;
    evidenceLabel: string;
    organized: boolean;
    catalogIds: string[];
    files: { path: string; size: number | null }[];
  }[];
  portalStatus?: string;
  reconciliationMessage?: string;
  nextSteps: string[];
  limitations: string[];
}

@Component({
  selector: 'app-import-match-review',
  imports: [DatePipe, Dialog],
  styleUrl: './import-match-review.component.scss',
  template: `
    <button class="app-baseline-button" type="button" (click)="show()">Review Stash match</button>
    <p-dialog
      header="Review imported file and Stash match"
      [visible]="open()"
      (visibleChange)="setOpen($event)"
      [modal]="true"
      [closable]="!reconciling()"
      [closeOnEscape]="!reconciling()"
      [blockScroll]="true"
      [appendTo]="'body'"
      [style]="{ width: '48rem', maxWidth: '95vw' }"
      styleClass="app-review-dialog"
    >
      <div class="match-review-body">
        <p>
          A downloaded file and its catalog association are separate. This review helps you locate
          and identify the file.
        </p>
        @if (loading()) {
          <p role="status">Checking Whisparr and Stash…</p>
        }
        @if (error()) {
          <p role="alert">{{ error() }}</p>
        }
        @if (review(); as review) {
          <p class="review-summary" role="status">{{ review.summary }}</p>
          <dl>
            <dt>Live check</dt>
            <dd>{{ review.checkedAt | date: 'medium' }}</dd>
            <dt>Last Stash snapshot</dt>
            <dd>
              {{
                review.snapshotAt
                  ? (review.snapshotAt | date: 'medium')
                  : 'No successful snapshot recorded'
              }}
            </dd>
            <dt>Whisparr lookup</dt>
            <dd>{{ sourceLabel(review.whisparr.state) }}</dd>
            <dt>Imported file reported</dt>
            <dd>
              {{
                review.whisparr.hasFile === null
                  ? 'Unverified'
                  : review.whisparr.hasFile
                    ? 'Yes'
                    : 'No'
              }}
            </dd>
            <dt>Reported file path</dt>
            <dd>
              <code>{{ review.whisparr.filePath ?? 'Not supplied by Whisparr' }}</code>
            </dd>
            @if (review.whisparr.fileSize !== null) {
              <dt>Reported size</dt>
              <dd>{{ review.whisparr.fileSize }} bytes</dd>
            }
            <dt>Stash lookup</dt>
            <dd>{{ sourceLabel(review.stash.state) }}</dd>
          </dl>
          <div class="app-action-row">
            @if (review.whisparr.viewUrl) {
              <a
                class="app-baseline-button"
                [href]="review.whisparr.viewUrl"
                target="_blank"
                rel="noopener noreferrer"
                >Open Whisparr</a
              >
            }
            @if (review.stash.viewUrl) {
              <a
                class="app-baseline-button"
                [href]="review.stash.viewUrl"
                target="_blank"
                rel="noopener noreferrer"
                >Open Stash scene</a
              >
            }
          </div>
          @if (review.candidates.length) {
            <h3>Stash records to review</h3>
            @for (candidate of review.candidates; track candidate.id) {
              <article class="match-candidate">
                <h4>{{ candidate.title }}</h4>
                <p>{{ candidate.evidenceLabel }}</p>
                <p>
                  {{ candidate.organized ? 'Marked organized' : 'Not marked organized' }} · Catalog
                  links: {{ candidate.catalogIds.join(', ') || 'No link to the selected catalog' }}
                </p>
                @for (file of candidate.files; track file.path) {
                  <p>
                    <code>{{ file.path }}</code>
                    @if (file.size !== null) {
                      · {{ file.size }} bytes
                    }
                  </p>
                }
                @if (candidate.viewUrl) {
                  <a
                    class="app-baseline-button"
                    [href]="candidate.viewUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    >Review in Stash</a
                  >
                }
              </article>
            }
          }
          <h3>Recovery</h3>
          <p>
            If Whisparr has the correct file, it still needs to be scanned and linked to this
            catalog scene in Stash before Portal can mark it available.
          </p>
          <details>
            <summary>The file is matched to the wrong scene</summary>
            <p>
              Compare the actual video in Stash with the Whisparr entry and the requested catalog
              scene first. If the Whisparr assignment is incorrect, correct it with manual import
              while preserving the file. If only the Stash catalog link is wrong or missing, review
              Identify on the specific Stash scene and save the intended association. Then refresh
              this scene. Re-requesting cannot correct an existing file assignment.
            </p>
          </details>
          <h3>Next steps</h3>
          <ol>
            @for (step of review.nextSteps; track step) {
              <li>{{ step }}</li>
            }
          </ol>
          <details>
            <summary>What this check can confirm</summary>
            <ul>
              @for (limit of review.limitations; track limit) {
                <li>{{ limit }}</li>
              }
            </ul>
          </details>
        }
        <p class="review-note">
          Checking this panel does not start a download, scan, identification job or metadata
          change. Refresh this scene only updates Portal’s observations of the existing file and
          catalog links.
        </p>
        @if (review()?.reconciliationMessage; as message) {
          <p role="status">{{ message }}</p>
        }
        <div class="app-action-row">
          <button
            class="app-baseline-button"
            type="button"
            [disabled]="loading() || reconciling()"
            (click)="reconcile()"
          >
            {{ reconciling() ? 'Refreshing…' : 'Refresh this scene' }}
          </button>
          <button
            class="app-baseline-button"
            type="button"
            [disabled]="loading() || reconciling()"
            (click)="load()"
          >
            Re-check match
          </button>
          <button
            class="app-baseline-button"
            type="button"
            [disabled]="reconciling()"
            (click)="setOpen(false)"
          >
            Close
          </button>
        </div>
      </div>
    </p-dialog>
  `,
})
export class ImportMatchReviewComponent implements OnDestroy, OnChanges {
  @Input({ required: true }) sceneId = '';
  @Output() reconciled = new EventEmitter<void>();
  protected readonly reconciling = signal(false);
  private didReconcile = false;
  private readonly http = inject(HttpClient);
  private request: Subscription | null = null;
  protected readonly open = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly review = signal<ImportMatchReview | null>(null);
  protected show(): void {
    this.open.set(true);
    this.load();
  }
  protected setOpen(value: boolean): void {
    if (this.reconciling()) return;
    this.open.set(value);
    if (!value) {
      this.request?.unsubscribe();
      this.loading.set(false);
      if (this.didReconcile) {
        this.didReconcile = false;
        this.reconciled.emit();
      }
    }
  }
  protected sourceLabel(state: string): string {
    return state === 'CHECKED'
      ? 'Checked now'
      : state === 'NOT_CONFIGURED'
        ? 'Not configured'
        : 'Unavailable or incomplete';
  }
  protected load(): void {
    if (!this.sceneId || this.reconciling()) return;
    this.request?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    this.review.set(null);
    this.request = this.http
      .get<ImportMatchReview>(
        `/api/acquisition/scenes/${encodeURIComponent(this.sceneId)}/match-review`,
      )
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (data) => this.review.set(data),
        error: () =>
          this.error.set(
            'The match review could not be loaded. Check the integrations or refresh Portal status, then try again.',
          ),
      });
  }
  protected reconcile(): void {
    if (!this.sceneId || this.loading() || this.reconciling()) return;
    this.reconciling.set(true);
    this.error.set(null);
    this.request = this.http
      .post<ImportMatchReview>(
        `/api/acquisition/scenes/${encodeURIComponent(this.sceneId)}/reconcile`,
        {},
      )
      .pipe(finalize(() => this.reconciling.set(false)))
      .subscribe({
        next: (data) => {
          this.review.set(data);
          this.didReconcile = true;
        },
        error: () =>
          this.error.set(
            'The refresh could not be confirmed. Re-check the match and integration status before trying again.',
          ),
      });
  }
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['sceneId']) {
      this.didReconcile = false;
      this.request?.unsubscribe();
      this.open.set(false);
      this.review.set(null);
      this.error.set(null);
      this.loading.set(false);
    }
  }
  ngOnDestroy(): void {
    this.request?.unsubscribe();
  }
}
