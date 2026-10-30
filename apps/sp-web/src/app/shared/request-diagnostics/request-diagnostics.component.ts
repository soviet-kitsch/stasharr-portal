import { Component, Input, Output, EventEmitter, OnDestroy, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Dialog } from 'primeng/dialog';
import { Tooltip } from 'primeng/tooltip';
import { newOperationKey } from '../../core/api/operation-key';
import { requestOutcomeMessage } from '../request-actions/request-outcome';
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
  kind?: string;
}
interface Details {
  summary: { code?: string; label: string; detail: string; checkedAt: string } | null;
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

interface ActionHistory {
  dismissed: boolean;
  activeActionId: string | null;
  actions: Array<{
    id: string;
    kind: string;
    state: string;
    createdAt: string;
    updatedAt?: string;
    result: { outcome?: string; message?: string } | null;
  }>;
}
interface Activity {
  id: string;
  label: string;
  detail: string;
  at: string;
  source: string;
}

@Component({
  selector: 'app-request-diagnostics',
  host: { '[class.triggerless]': '!showTrigger' },
  imports: [Tooltip, Dialog, DatePipe, HydraSearchComponent],
  templateUrl: './request-diagnostics.component.html',
  styleUrl: './request-diagnostics.component.scss',
})
export class RequestDiagnosticsComponent implements OnDestroy {
  @Input({ required: true }) sceneId = '';
  @Input() sceneTitle = '';
  @Input() compact = false;
  @Input() showTrigger = true;
  @Output() changed = new EventEmitter<void>();
  private readonly http = inject(HttpClient);
  protected readonly open = signal(false);
  protected readonly busy = signal(false);
  protected readonly message = signal('');
  protected readonly data = signal<Details | null>(null);
  protected readonly history = signal<ActionHistory | null>(null);
  protected readonly historyLoading = signal(false);
  protected readonly historyError = signal('');
  protected readonly recoveryBusy = signal(false);
  protected readonly allActivity = signal(false);
  protected readonly searchExpanded = signal(false);
  private readonly recoveryKeys = new Map<string, string>();
  private timer?: ReturnType<typeof setInterval>;
  private generation = 0;
  private loadGeneration = 0;
  private historyGeneration = 0;
  protected running() {
    return (
      this.data()?.attempts.some(
        (a) => a.mode === 'DIAGNOSTIC' && ['QUEUED', 'RUNNING', 'UNCERTAIN'].includes(a.state),
      ) ?? false
    );
  }
  show() {
    this.open.set(true);
    this.data.set(null);
    this.history.set(null);
    this.message.set('');
    this.historyError.set('');
    this.allActivity.set(false);
    this.searchExpanded.set(false);
    this.generation++;
    this.load();
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (this.open() && !this.busy() && !this.recoveryBusy()) this.load();
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
  protected load() {
    const generation = this.generation;
    const request = ++this.loadGeneration;
    this.busy.set(true);
    this.loadHistory();
    this.http.get<Details>(this.path() + '/diagnostics').subscribe({
      next: (value) => {
        if (generation !== this.generation || request !== this.loadGeneration) return;
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
        if (generation !== this.generation || request !== this.loadGeneration) return;
        this.busy.set(false);
        this.message.set(
          'Diagnostics could not be loaded. Check the Whisparr connection and retry.',
        );
      },
    });
  }
  protected loadHistory() {
    const generation = this.generation;
    const request = ++this.historyGeneration;
    this.historyLoading.set(true);
    this.http.get<ActionHistory>(this.path() + '/history').subscribe({
      next: (value) => {
        if (generation !== this.generation || request !== this.historyGeneration) return;
        this.history.set(value);
        this.historyError.set('');
        this.historyLoading.set(false);
      },
      error: () => {
        if (generation !== this.generation || request !== this.historyGeneration) return;
        this.historyLoading.set(false);
        this.historyError.set('Portal action history could not be refreshed.');
      },
    });
  }
  protected recoverRequest(action: 'outcome' | 'restore') {
    if (this.recoveryBusy()) return;
    this.recoveryBusy.set(true);
    this.message.set('');
    const key = this.recoveryKeys.get(action) ?? newOperationKey();
    this.recoveryKeys.set(action, key);
    // A submitted recovery remains scene-scoped if the dialog is closed during the request.
    const path = this.path();
    const generation = this.generation;
    this.http.post<{ outcome: string }>(path + '/' + action, { operationKey: key }).subscribe({
      next: (result) => {
        this.recoveryKeys.delete(action);
        this.recoveryBusy.set(false);
        this.changed.emit();
        if (generation !== this.generation) return;
        this.message.set(
          requestOutcomeMessage(result.outcome) ||
            (result.outcome === 'NO_PENDING_ACTION'
              ? 'No action is awaiting an outcome.'
              : 'Outcome checked.'),
        );
        this.load();
      },
      error: (error) => {
        if (error.error?.actionState === 'FAILED' || (error.status && error.status !== 409))
          this.recoveryKeys.delete(action);
        this.recoveryBusy.set(false);
        if (generation !== this.generation) return;
        this.message.set(
          typeof error.error?.message === 'string'
            ? error.error.message
            : 'The outcome is still unknown. Check the recorded history before retrying.',
        );
        this.load();
      },
    });
  }
  protected activity(): Activity[] {
    const actions = this.history()?.actions ?? [];
    const items: Activity[] = actions.map((a) => ({
      id: 'action:' + a.id,
      label: this.actionLabel(a.kind) + ' · ' + this.stateLabel(a.state),
      detail: a.result?.message || requestOutcomeMessage(a.result?.outcome),
      at: a.updatedAt || a.createdAt,
      source: 'Portal',
    }));
    for (const event of this.data()?.events ?? []) {
      const duplicate =
        event.source === 'PORTAL' &&
        actions.some(
          (a) =>
            event.label === a.kind.replaceAll('_', ' ') + ': ' + a.state.toLowerCase() &&
            Date.parse(event.occurredAt) === Date.parse(a.updatedAt || a.createdAt),
        );
      if (!duplicate)
        items.push({
          id: 'event:' + event.id,
          label: event.label,
          detail: '',
          at: event.occurredAt,
          source:
            event.source === 'PORTAL'
              ? 'Portal'
              : event.label.startsWith('Observed:')
                ? 'Observation'
                : 'Whisparr',
        });
    }
    return items.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  }
  protected actionLabel(kind: string) {
    return (
      (
        {
          REQUEST: 'Request',
          RE_REQUEST: 'Re-request',
          SEARCH: 'Search again',
          DISMISS: 'Delete from Portal',
          RESTORE: 'Restore request',
          DIAGNOSTIC_SEARCH: 'Diagnostic search',
        } as Record<string, string>
      )[kind] ?? 'Request action'
    );
  }
  protected stateLabel(state: string) {
    return (
      (
        {
          RUNNING: 'In progress',
          SUCCEEDED: 'Confirmed',
          FAILED: 'Not completed',
          UNCERTAIN: 'Outcome needs checking',
        } as Record<string, string>
      )[state] ?? 'Check outcome'
    );
  }
  protected nextStep() {
    const code = this.data()?.summary?.code;
    return (
      (
        {
          WAITING_FOR_STASH_MATCH: 'Review the Stash match from the acquisition row.',
          WHISPARR_IMPORT_PENDING: 'Open Whisparr to review the download’s import status.',
          ORPHANED_REQUEST:
            'Re-request from the acquisition row to restore the missing Whisparr entry.',
          ALL_REJECTED: 'Expand Search decisions to see why releases were rejected.',
          NO_CANDIDATES: 'Try a broader search in NZBHydra or wait for another release.',
          STATUS_UNAVAILABLE: 'Refresh status to check the connected services.',
          UNKNOWN: 'No search results were retained. Search decisions can run a fresh check.',
        } as Record<string, string>
      )[code ?? ''] ?? ''
    );
  }
  protected unresolvedAttempts() {
    return (
      this.data()?.attempts.filter(
        (a) =>
          a.mode === 'DIAGNOSTIC' &&
          (a.state === 'UNCERTAIN' || (a.needsReview && a.state === 'COMPLETED')),
      ) ?? []
    );
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
    const request = ++this.loadGeneration;
    this.http
      .get<Details>(this.path() + '/diagnostics', {
        params: new HttpParams().set(kind === 'events' ? 'eventBefore' : 'attemptBefore', cursor),
      })
      .subscribe({
        next: (value) => {
          if (generation !== this.generation || request !== this.loadGeneration) return;
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
          if (generation !== this.generation || request !== this.loadGeneration) return;
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
  protected attemptState(state: string) {
    return (
      (
        {
          QUEUED: 'Queued',
          RUNNING: 'Running',
          COMPLETED: 'Completed',
          UNCERTAIN: 'Outcome unconfirmed',
          FAILED: 'Failed',
          CLOSED: 'Closed',
        } as Record<string, string>
      )[state] ?? 'Unknown'
    );
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
