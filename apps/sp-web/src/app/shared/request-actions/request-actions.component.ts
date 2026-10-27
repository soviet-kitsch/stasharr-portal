import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { finalize } from 'rxjs';
import { Dialog } from 'primeng/dialog';
import { SceneRequestModalComponent } from '../scene-request-modal/scene-request-modal.component';

interface ActionHistory {
  dismissed: boolean;
  activeActionId: string | null;
  actions: Array<{
    id: string;
    kind: string;
    state: string;
    createdAt: string;
    result: { outcome?: string } | null;
  }>;
}

@Component({
  selector: 'app-request-actions',
  imports: [Dialog, DatePipe, SceneRequestModalComponent],
  styleUrl: './request-actions.component.scss',
  template: `
    <div class="app-action-row">
      @if (tracked && (!condition || condition === 'ORPHANED_REQUEST')) {
        <button
          class="secondary-action small"
          type="button"
          [disabled]="busy()"
          (click)="requestOpen.set(true)"
        >
          Re-request
        </button>
      }
      @if (tracked && (!condition || condition === 'WAITING_FOR_RELEASE')) {
        <button
          class="secondary-action small"
          type="button"
          [disabled]="busy()"
          (click)="execute('search')"
        >
          Search again
        </button>
      }
      @if (tracked) {
        <button
          class="secondary-action small"
          type="button"
          [disabled]="busy()"
          (click)="deleteOpen.set(true)"
        >
          Delete request
        </button>
      }
      <button
        class="secondary-action small"
        type="button"
        [disabled]="busy()"
        (click)="showHistory()"
      >
        Request history
      </button>
    </div>
    @if (message()) {
      <p role="status">{{ message() }}</p>
    }
    <p-dialog
      header="Delete request from Portal?"
      [visible]="deleteOpen()"
      (visibleChange)="deleteOpen.set($event)"
      [modal]="true"
      [closable]="!busy()"
      [closeOnEscape]="!busy()"
      [style]="{ width: '32rem', maxWidth: '95vw' }"
    >
      <p>{{ sceneTitle }}</p>
      <p>
        This removes the request from Portal's active queue. Whisparr entries, downloads and media
        files remain unchanged. The history is kept, and you can restore the request.
      </p>
      <button type="button" [disabled]="busy()" (click)="execute('dismiss')">
        {{ busy() ? 'Removing…' : 'Delete from Portal' }}
      </button>
      <button type="button" [disabled]="busy()" (click)="deleteOpen.set(false)">Cancel</button>
    </p-dialog>
    <p-dialog
      header="Request history"
      [visible]="historyOpen()"
      (visibleChange)="historyOpen.set($event)"
      [modal]="true"
      [style]="{ width: '38rem', maxWidth: '95vw' }"
    >
      <p>{{ sceneTitle }}</p>
      @if (history(); as value) {
        @if (value.activeActionId) {
          <p>An action is running or its outcome needs checking.</p>
          <button type="button" [disabled]="busy()" (click)="execute('outcome')">
            Check outcome
          </button>
        }
        @if (value.dismissed) {
          <button type="button" [disabled]="busy()" (click)="execute('restore')">
            Restore request
          </button>
        }
        <ol class="action-history">
          @for (action of value.actions; track action.id) {
            <li>
              <strong>{{ actionLabel(action.kind) }}</strong> — {{ stateLabel(action.state)
              }}<time>{{ action.createdAt | date: 'medium' }}</time>
            </li>
          }
        </ol>
        @if (!value.actions.length) {
          <p>No recorded actions yet.</p>
        }
      }
      @if (message()) {
        <p role="status">{{ message() }}</p>
      }
    </p-dialog>
    <app-scene-request-modal
      [open]="requestOpen()"
      [sceneId]="sceneId"
      [sceneTitle]="sceneTitle"
      [rerequest]="true"
      (closed)="requestOpen.set(false)"
      (submitted)="changed.emit()"
    />
  `,
})
export class RequestActionsComponent {
  @Input({ required: true }) sceneId!: string;
  @Input() sceneTitle = '';
  @Input() condition: string | null = null;
  @Input() tracked = true;
  @Output() changed = new EventEmitter<void>();
  private readonly http = inject(HttpClient);
  protected readonly busy = signal(false);
  protected readonly requestOpen = signal(false);
  protected readonly deleteOpen = signal(false);
  protected readonly historyOpen = signal(false);
  protected readonly history = signal<ActionHistory | null>(null);
  protected readonly message = signal<string | null>(null);
  private keys = new Map<string, string>();
  protected actionLabel(kind: string): string {
    return (
      (
        {
          REQUEST: 'Request',
          RE_REQUEST: 'Re-request',
          SEARCH: 'Search again',
          DISMISS: 'Delete from Portal',
          RESTORE: 'Restore request',
        } as Record<string, string>
      )[kind] ?? 'Request action'
    );
  }
  protected stateLabel(state: string): string {
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

  protected showHistory(): void {
    this.historyOpen.set(true);
    this.http
      .get<ActionHistory>(`/api/requests/${encodeURIComponent(this.sceneId)}/history`)
      .subscribe({
        next: (value) => this.history.set(value),
        error: () => this.message.set('Could not load request history.'),
      });
  }

  protected execute(action: 'search' | 'dismiss' | 'restore' | 'outcome'): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.message.set(null);
    const key = this.keys.get(action) ?? crypto.randomUUID();
    this.keys.set(action, key);
    this.http
      .post<{ outcome: string }>(`/api/requests/${encodeURIComponent(this.sceneId)}/${action}`, {
        operationKey: key,
      })
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (result) => {
          this.keys.delete(action);
          this.message.set(
            (
              {
                SEARCH_STARTED: 'Search started. Monitoring settings are unchanged.',
                ALREADY_AVAILABLE: 'Already available in Stash.',
                ALREADY_QUEUED: 'Already in the download queue.',
                ALREADY_SEARCHING: 'A search is already running or was just started.',
                DISMISSED: 'Removed from Portal. Downloads and files were preserved.',
                RESTORED: 'Request restored.',
                REQUEST_CONFIRMED: 'The request is confirmed in Whisparr or Stash.',
                NOT_SENT: 'The interrupted action was not sent. You can try again.',
                NO_PENDING_ACTION: 'No action is awaiting an outcome.',
              } as Record<string, string>
            )[result.outcome] ?? 'Outcome checked.',
          );
          this.deleteOpen.set(false);
          if (this.historyOpen()) this.showHistory();
          if (action === 'dismiss' || action === 'restore' || action === 'outcome')
            this.changed.emit();
        },
        error: (error) => {
          if (error.error?.actionState === 'FAILED' || (error.status && error.status !== 409))
            this.keys.delete(action);
          this.message.set(
            typeof error.error?.message === 'string'
              ? error.error.message
              : 'The result is unknown. Open request history and check the outcome before retrying.',
          );
          this.showHistory();
        },
      });
  }
}
