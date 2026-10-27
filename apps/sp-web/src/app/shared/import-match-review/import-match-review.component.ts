import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  Component,
  Input,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core';
import { Subscription, finalize } from 'rxjs';
import { Dialog } from 'primeng/dialog';
import { ButtonDirective } from 'primeng/button';

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
  nextSteps: string[];
  limitations: string[];
}

@Component({
  selector: 'app-import-match-review',
  imports: [DatePipe, Dialog, ButtonDirective],
  styleUrl: './import-match-review.component.scss',
  template: `
    <button pButton type="button" severity="secondary" size="small" (click)="show()">
      Review Stash match
    </button>
    <p-dialog
      header="Review imported file and Stash match"
      [visible]="open()"
      (visibleChange)="setOpen($event)"
      [modal]="true"
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
                pButton
                severity="secondary"
                size="small"
                [href]="review.whisparr.viewUrl"
                target="_blank"
                rel="noopener noreferrer"
                >Open Whisparr</a
              >
            }
            @if (review.stash.viewUrl) {
              <a
                pButton
                severity="secondary"
                size="small"
                [href]="review.stash.viewUrl"
                target="_blank"
                rel="noopener noreferrer"
                >Open Stash library</a
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
                    pButton
                    severity="secondary"
                    size="small"
                    [href]="candidate.viewUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    >Review in Stash</a
                  >
                }
              </article>
            }
          }
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
          change. After completing those steps in Stash, refresh Portal status.
        </p>
        <div class="app-action-row">
          <button
            pButton
            type="button"
            severity="secondary"
            [disabled]="loading()"
            (click)="load()"
          >
            Re-check match
          </button>
          <button pButton type="button" severity="secondary" (click)="setOpen(false)">Close</button>
        </div>
      </div>
    </p-dialog>
  `,
})
export class ImportMatchReviewComponent implements OnDestroy, OnChanges {
  @Input({ required: true }) sceneId = '';
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
    this.open.set(value);
    if (!value) {
      this.request?.unsubscribe();
      this.loading.set(false);
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
    if (!this.sceneId) return;
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
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['sceneId']) {
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
