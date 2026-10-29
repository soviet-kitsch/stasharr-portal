import { Component, Input, OnDestroy, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Dialog } from 'primeng/dialog';
import { newOperationKey } from '../../core/api/operation-key';
import { HydraSearchComponent } from './hydra-search.component';

interface Attempt {
  id: string;
  movieId: number;
  mode: string;
  state: string;
  outcome: string;
  createdAt: string;
  candidateCount: number | null;
  rejectedCount: number | null;
  currentIntegration: boolean;
  needsReview?: boolean;
  candidates: Array<{
    rank: number;
    title: string;
    indexer: string;
    quality: string;
    size: number | null;
    seeders: number | null;
    mappedMovieId: number | null;
    approved: boolean;
    rejections: string[];
  }> | null;
}
interface DiagnosticEvent {
  id: string;
  label: string;
  source: string;
  occurredAt: string;
  observedAt: string;
}
interface Details {
  summary: { label: string; detail: string; checkedAt: string } | null;
  events: DiagnosticEvent[];
  attempts: Attempt[];
  nextEventCursor?: string;
  nextAttemptCursor?: string;
  hasMoreEvents: boolean;
  hasMoreAttempts: boolean;
  limitations: string[];
  whisparrUrl: string | null;
  sync: { checkedAt: string | null; error: string | null } | null;
}

@Component({
  selector: 'app-request-diagnostics',
  imports: [Dialog, DatePipe, HydraSearchComponent],
  styles: [
    `
      :host {
        display: inline-block;
      }
      .summary {
        font-size: 1.1rem;
      }
      li {
        margin: 0.75rem 0;
      }
      .muted {
        opacity: 0.75;
      }
      .attempt {
        border-bottom: 1px solid var(--p-content-border-color);
        padding: 0.75rem 0;
      }
      .candidates {
        display: block;
      }
      .candidate {
        border-bottom: 1px solid var(--p-content-border-color);
        padding: 0.75rem 0;
      }
      .app-action-row {
        margin: 0.75rem 0;
      }
      time {
        font-size: 0.85rem;
      }
    `,
  ],
  template: ` <button class="app-baseline-button small" type="button" (click)="show()">
      Request details
    </button>
    <p-dialog
      header="Request details"
      styleClass="app-review-dialog"
      [visible]="open()"
      (visibleChange)="visibility($event)"
      [modal]="true"
      [closeOnEscape]="true"
      [appendTo]="'body'"
      [style]="{ width: '60rem', maxWidth: '96vw' }"
    >
      <div class="diagnostics-body">
        <h3>{{ sceneTitle }}</h3>
        <div class="app-action-row">
          <button class="app-baseline-button" type="button" (click)="visibility(false)">
            Close details
          </button>
          <button class="app-baseline-button" [disabled]="busy()" (click)="refresh()">
            Refresh observations
          </button>
          <button
            class="app-baseline-button"
            [disabled]="busy() || running()"
            (click)="runSearch()"
          >
            Run diagnostic search
          </button>
          <app-hydra-search [inline]="true" [sceneId]="sceneId" [sceneTitle]="sceneTitle" />
          @if (data()?.whisparrUrl; as url) {
            <a class="app-baseline-button" [href]="url" target="_blank" rel="noopener noreferrer"
              >Open Whisparr</a
            >
          }
        </div>
        <p class="muted">
          Diagnostic search checks fresh release decisions without grabbing. It uses indexer quota.
          Search again and Re-request can acquire releases.
        </p>
        @if (message()) {
          <p role="status">{{ message() }}</p>
        }
        @if (data(); as value) {
          <p class="summary">
            <strong>{{ value.summary?.label || 'No retained observations' }}</strong>
          </p>
          <p>{{ value.summary?.detail }}</p>
          <p class="muted">
            Last observation: {{ value.summary?.checkedAt | date: 'medium' }}. Native history
            checked: {{ value.sync?.checkedAt | date: 'medium' }}.
          </p>
          @if (value.sync?.error) {
            <p role="status">{{ value.sync?.error }}</p>
          }
          <h4>Search attempts</h4>
          @for (attempt of value.attempts; track attempt.id) {
            <div class="attempt">
              <strong>{{
                attempt.mode === 'DIAGNOSTIC' ? 'Diagnostic search' : 'Whisparr search'
              }}</strong>
              · {{ attempt.state }} · {{ outcome(attempt) }}
              <p>
                <time>{{ attempt.createdAt | date: 'medium' }}</time>
                @if (!attempt.currentIntegration) {
                  · Previous integration
                }
              </p>
              @if (attempt.candidates) {
                <button class="app-baseline-button" (click)="selected.set(attempt)">
                  Inspect candidates
                </button>
              }
              @if (attempt.mode === 'DIAGNOSTIC' && attempt.state === 'UNCERTAIN') {
                <p>
                  Results were not confirmed. After checking Whisparr, close this interrupted
                  diagnostic to release its search guard. No search will be retried.
                </p>
                <button
                  class="app-baseline-button"
                  [disabled]="busy()"
                  (click)="closeInterrupted(attempt.id)"
                >
                  Close interrupted diagnostic
                </button>
              }
              @if (attempt.needsReview && attempt.state === 'COMPLETED') {
                <button
                  class="app-baseline-button"
                  [disabled]="busy()"
                  (click)="closeInterrupted(attempt.id)"
                >
                  Confirm recorded diagnostic outcome
                </button>
              }
            </div>
          } @empty {
            <p>No retained search history. This does not mean no search occurred.</p>
          }
          @if (value.hasMoreAttempts) {
            <button class="app-baseline-button" [disabled]="busy()" (click)="more('attempts')">
              Older search attempts
            </button>
          }
          @if (selected(); as attempt) {
            <h4>Candidate decisions · {{ attempt.createdAt | date: 'medium' }}</h4>
            <p>
              Whisparr's returned order. Source coverage and raw indexer hit counts are unknown.
              {{ attempt.candidateCount }} evaluated, {{ attempt.rejectedCount }} rejected; up to
              200 detailed candidates retained.
            </p>
            <div class="candidates">
              @for (candidate of attempt.candidates; track candidate.rank) {
                <article class="candidate">
                  <strong>#{{ candidate.rank }} {{ candidate.title }}</strong>
                  <p>
                    {{ candidate.indexer }} · {{ candidate.quality || 'Quality unknown' }} ·
                    {{ bytes(candidate.size) }} · Seeders: {{ candidate.seeders ?? 'Unknown' }}
                  </p>
                  @if (candidate.mappedMovieId && candidate.mappedMovieId !== attempt.movieId) {
                    <p><strong>Mapped to a different Whisparr scene</strong></p>
                  } @else if (!candidate.mappedMovieId) {
                    <p>Scene identity not confirmed by Whisparr.</p>
                  } @else if (candidate.rank === topRank(attempt)) {
                    <p><strong>Top returned candidate for this scene</strong></p>
                  }
                  @for (reason of candidate.rejections; track $index) {
                    <p>Rejected: {{ reason }}</p>
                  }
                  @if (!candidate.rejections.length) {
                    <p>
                      {{
                        candidate.approved
                          ? 'Accepted by evaluation; no download submitted by this diagnostic.'
                          : 'No rejection explanation supplied.'
                      }}
                    </p>
                  }
                </article>
              }
            </div>
          }
          <h4>Timeline</h4>
          <ol>
            @for (event of value.events; track event.id) {
              <li>
                {{ event.label }}<br /><time>{{ event.occurredAt | date: 'medium' }}</time>
                <span class="muted">
                  ·
                  {{
                    event.source === 'PORTAL'
                      ? 'Portal action'
                      : event.label.startsWith('Observed:')
                        ? 'Observed state'
                        : 'Whisparr event'
                  }}</span
                >
              </li>
            } @empty {
              <li>No retained events yet.</li>
            }
          </ol>
          @if (value.hasMoreEvents) {
            <button class="app-baseline-button" [disabled]="busy()" (click)="more('events')">
              Older events
            </button>
          }
          <details>
            <summary>Evidence limitations</summary>
            @for (limit of value.limitations; track limit) {
              <p>{{ limit }}</p>
            }
          </details>
        }
      </div>
    </p-dialog>`,
})
export class RequestDiagnosticsComponent implements OnDestroy {
  @Input({ required: true }) sceneId = '';
  @Input() sceneTitle = '';
  private readonly http = inject(HttpClient);
  protected readonly open = signal(false);
  protected readonly busy = signal(false);
  protected readonly message = signal('');
  protected readonly data = signal<Details | null>(null);
  protected readonly selected = signal<Attempt | null>(null);
  private timer?: ReturnType<typeof setInterval>;
  private generation = 0;
  protected running() {
    return (
      this.data()?.attempts.some(
        (a) => a.mode === 'DIAGNOSTIC' && ['QUEUED', 'RUNNING', 'UNCERTAIN'].includes(a.state),
      ) ?? false
    );
  }
  protected show() {
    this.open.set(true);
    this.data.set(null);
    this.selected.set(null);
    this.generation++;
    this.load();
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (this.open() && !this.busy()) this.load();
    }, 15_000);
  }
  protected visibility(visible: boolean) {
    this.open.set(visible);
    if (!visible) {
      this.generation++;
      clearInterval(this.timer);
    }
  }
  private path() {
    return '/api/requests/' + encodeURIComponent(this.sceneId);
  }
  private load() {
    const generation = this.generation;
    this.busy.set(true);
    this.http.get<Details>(this.path() + '/diagnostics').subscribe({
      next: (value) => {
        if (generation !== this.generation) return;
        const old = this.data();
        const merge = <T extends { id: string }>(oldRows: T[], newRows: T[]) => [
          ...new Map([...oldRows, ...newRows].map((row) => [row.id, row])).values(),
        ];
        if (old)
          value = {
            ...value,
            events: merge(old.events, value.events),
            attempts: merge(old.attempts, value.attempts),
            ...(old.events.length > 50
              ? { hasMoreEvents: old.hasMoreEvents, nextEventCursor: old.nextEventCursor }
              : {}),
            ...(old.attempts.length > 50
              ? { hasMoreAttempts: old.hasMoreAttempts, nextAttemptCursor: old.nextAttemptCursor }
              : {}),
          };
        value.events.sort(
          (a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id),
        );
        value.attempts.sort(
          (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
        );
        this.data.set(value);
        this.busy.set(false);
        if (this.message().startsWith('Diagnostics could not')) this.message.set('');
      },
      error: () => {
        if (generation !== this.generation) return;
        this.busy.set(false);
        this.message.set(
          'Diagnostics could not be loaded. Check the Whisparr connection and retry.',
        );
      },
    });
  }
  protected refresh() {
    this.action('/diagnostics/refresh', {}, 'Observations refreshed.');
  }
  protected runSearch() {
    this.action(
      '/diagnostic-searches',
      { operationKey: newOperationKey() },
      'Diagnostic search recorded. Results will appear automatically.',
    );
  }
  protected closeInterrupted(id: string) {
    this.action(
      '/diagnostic-searches/' + encodeURIComponent(id) + '/close',
      {},
      'Interrupted diagnostic closed without retrying.',
    );
  }
  private action(path: string, body: unknown, success: string) {
    if (this.busy()) return;
    this.busy.set(true);
    const generation = this.generation;
    this.http.post(this.path() + path, body).subscribe({
      next: () => {
        if (generation !== this.generation) return;
        this.message.set(success);
        this.busy.set(false);
        this.load();
      },
      error: () => {
        if (generation !== this.generation) return;
        this.busy.set(false);
        this.message.set(
          'Action could not be confirmed. Inspect the recorded outcome before retrying; a search may still be running or its guard may need review.',
        );
        this.load();
      },
    });
  }
  protected more(kind: 'events' | 'attempts') {
    const old = this.data();
    const cursor = kind === 'events' ? old?.nextEventCursor : old?.nextAttemptCursor;
    if (!old || !cursor || this.busy()) return;
    this.busy.set(true);
    const generation = this.generation;
    this.http
      .get<Details>(this.path() + '/diagnostics', {
        params: new HttpParams().set(kind === 'events' ? 'eventBefore' : 'attemptBefore', cursor),
      })
      .subscribe({
        next: (value) => {
          if (generation !== this.generation) return;
          this.data.set(
            kind === 'events'
              ? {
                  ...old,
                  events: [...old.events, ...value.events],
                  hasMoreEvents: value.hasMoreEvents,
                  nextEventCursor: value.nextEventCursor,
                }
              : {
                  ...old,
                  attempts: [...old.attempts, ...value.attempts],
                  hasMoreAttempts: value.hasMoreAttempts,
                  nextAttemptCursor: value.nextAttemptCursor,
                },
          );
          this.busy.set(false);
        },
        error: () => {
          this.busy.set(false);
          this.message.set('Older history could not be loaded. Your current history is retained.');
        },
      });
  }
  protected outcome(a: Attempt) {
    return a.candidateCount === null
      ? 'Result count unknown'
      : `${a.candidateCount} evaluated · ${a.rejectedCount ?? 'Unknown'} rejected`;
  }
  protected bytes(value: number | null) {
    return value === null ? 'Size unknown' : (value / 1024 ** 3).toFixed(2) + ' GiB';
  }
  protected topRank(a: Attempt) {
    return a.candidates?.find((c) => c.mappedMovieId === a.movieId)?.rank;
  }
  ngOnDestroy() {
    this.generation++;
    clearInterval(this.timer);
  }
}
