import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { finalize } from 'rxjs';
import { Dialog } from 'primeng/dialog';
import { SubmitSceneRequestPayload } from '../../core/api/discover.types';
import { SceneRequestModalComponent } from '../scene-request-modal/scene-request-modal.component';

type Kind = 'RE_REQUEST' | 'SEARCH' | 'DISMISS';
interface Row {
  id: string;
  eligible?: boolean;
  ok?: boolean;
  message?: string;
  result?: { outcome?: string; alreadyExists?: boolean };
}

@Component({
  selector: 'app-request-batch-actions',
  imports: [Dialog, SceneRequestModalComponent],
  styleUrl: './request-actions.component.scss',
  template: `
    @if (scenes.length) {
      <div class="app-action-row" role="region" aria-label="Selected requests">
        <span>{{ scenes.length }} selected (maximum 20)</span>
        <button
          type="button"
          class="secondary-action"
          [disabled]="busy()"
          (click)="preview('RE_REQUEST')"
        >
          Re-request selected
        </button>
        <button
          type="button"
          class="secondary-action"
          [disabled]="busy()"
          (click)="preview('SEARCH')"
        >
          Search selected
        </button>
        <button
          type="button"
          class="secondary-action"
          [disabled]="busy()"
          (click)="preview('DISMISS')"
        >
          Delete selected
        </button>
      </div>
    }
    <p-dialog
      header="Review selected requests"
      [visible]="open()"
      (visibleChange)="close($event)"
      [modal]="true"
      [closable]="!busy()"
      [closeOnEscape]="!busy()"
      [style]="{ width: '44rem', maxWidth: '95vw' }"
    >
      <p>
        {{
          kind() === 'DISMISS'
            ? 'Remove eligible requests from Portal only. Whisparr entries, downloads and files remain unchanged.'
            : kind() === 'SEARCH'
              ? 'Start one search per eligible entry. Existing monitoring settings remain unchanged.'
              : 'Re-request eligible scenes only if still missing. The reviewed settings will apply to every new entry in this selection.'
        }}
      </p>
      @if (busy()) {
        <p role="status">{{ completed() ? 'Retrieving results…' : 'Checking requests…' }}</p>
      }
      @for (row of rows(); track row.id) {
        <p>
          <strong>{{ title(row.id) }}</strong
          >:
          {{
            completed()
              ? row.ok
                ? 'Completed'
                : 'Not completed'
              : row.eligible
                ? 'Eligible'
                : 'Skipped'
          }}
          — {{ row.message ?? outcome(row) }}
        </p>
      }
      @if (error()) {
        <p role="alert">{{ error() }}</p>
      }
      @if (!completed()) {
        @if (kind() === 'RE_REQUEST' && eligibleIds().length) {
          <button type="button" [disabled]="busy()" (click)="settingsOpen.set(true)">
            {{ settings() ? 'Review settings again' : 'Choose acquisition settings' }}
          </button>
        }
        <button
          type="button"
          [disabled]="busy() || !eligibleIds().length || (kind() === 'RE_REQUEST' && !settings())"
          (click)="confirm()"
        >
          Confirm {{ eligibleIds().length }}
          {{ kind() === 'DISMISS' ? 'deletions from Portal' : 'actions' }}
        </button>
      }
      <button type="button" [disabled]="busy()" (click)="close(false)">
        {{ completed() ? 'Done' : 'Cancel' }}
      </button>
    </p-dialog>
    <app-scene-request-modal
      [open]="settingsOpen()"
      [sceneId]="eligibleIds().length ? eligibleIds()[0] : null"
      sceneTitle="Settings for all eligible selected requests"
      [settingsOnly]="true"
      (settingsSelected)="settings.set($event)"
      (closed)="settingsOpen.set(false)"
    />
  `,
})
export class RequestBatchActionsComponent {
  @Input() scenes: Array<{ id: string; title: string }> = [];
  @Output() finished = new EventEmitter<void>();
  private readonly http = inject(HttpClient);
  protected readonly open = signal(false);
  protected readonly busy = signal(false);
  protected readonly kind = signal<Kind>('SEARCH');
  protected readonly rows = signal<Row[]>([]);
  protected readonly completed = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly settingsOpen = signal(false);
  protected readonly settings = signal<SubmitSceneRequestPayload | null>(null);
  protected readonly eligibleIds = signal<string[]>([]);
  private key = '';
  private reviewedScenes: Array<{ id: string; title: string }> = [];
  protected title(id: string) {
    return this.reviewedScenes.find((scene) => scene.id === id)?.title ?? id;
  }
  protected outcome(row: Row) {
    return row.result?.alreadyExists
      ? 'Already present; no duplicate was sent.'
      : (row.result?.outcome?.replaceAll('_', ' ').toLowerCase() ?? '');
  }

  protected preview(kind: Kind): void {
    if (this.busy() || !this.scenes.length || this.scenes.length > 20) return;
    this.reviewedScenes = this.scenes.map((scene) => ({ ...scene }));
    this.key = crypto.randomUUID();
    this.kind.set(kind);
    this.open.set(true);
    this.busy.set(true);
    this.completed.set(false);
    this.error.set(null);
    this.rows.set([]);
    this.settings.set(null);
    this.eligibleIds.set([]);
    this.http
      .post<{ results: Row[] }>('/api/requests/batch/preview', {
        kind,
        ids: this.reviewedScenes.map((scene) => scene.id),
        operationKey: this.key,
      })
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (value) => {
          this.rows.set(value.results);
          this.eligibleIds.set(value.results.filter((row) => row.eligible).map((row) => row.id));
        },
        error: () => this.error.set('Could not verify this selection. No actions were taken.'),
      });
  }

  protected confirm(): void {
    if (
      this.busy() ||
      !this.eligibleIds().length ||
      (this.kind() === 'RE_REQUEST' && !this.settings())
    )
      return;
    this.busy.set(true);
    this.error.set(null);
    this.http
      .post<{ results: Row[] }>('/api/requests/batch/execute', {
        kind: this.kind(),
        ids: [...this.eligibleIds()],
        operationKey: this.key,
        ...(this.settings() ? { settings: this.settings() } : {}),
      })
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (value) => {
          this.rows.set(value.results);
          this.completed.set(true);
        },
        error: () =>
          this.error.set(
            'Results could not be confirmed. Retry this same reviewed batch to recover its recorded results, or inspect each request history.',
          ),
      });
  }

  protected close(visible: boolean): void {
    if (visible || this.busy()) return;
    const changed = this.completed();
    this.open.set(false);
    if (changed) this.finished.emit();
  }
}
