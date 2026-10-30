import { newOperationKey } from '../../core/api/operation-key';
import { RequestDiagnosticsComponent } from '../request-diagnostics/request-diagnostics.component';
import { Component, EventEmitter, Input, Output, ViewChild, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { finalize } from 'rxjs';
import { Dialog } from 'primeng/dialog';
import { Menu } from 'primeng/menu';
import { MenuItem } from 'primeng/api';
import { SceneRequestModalComponent } from '../scene-request-modal/scene-request-modal.component';

@Component({
  selector: 'app-request-actions',
  imports: [Dialog, Menu, SceneRequestModalComponent, RequestDiagnosticsComponent],
  styleUrl: './request-actions.component.scss',
  template: `
    <div class="app-action-row request-actions" [class.compact]="compact">
      @if (tracked) {
        <button
          class="app-baseline-button secondary-action small"
          type="button"
          [disabled]="busy()"
          [class.app-icon-button]="compact"
          [attr.aria-label]="compact ? 'Re-request' : null"
          [attr.title]="compact ? 'Re-request' : null"
          (click)="requestOpen.set(true)"
        >
          @if (compact) {
            <i class="pi pi-cloud-download" aria-hidden="true"></i>
          } @else {
            Re-request
          }
        </button>
      }
      @if (tracked && searchEnabled && (!condition || condition === 'WAITING_FOR_RELEASE')) {
        <button
          class="app-baseline-button secondary-action small"
          type="button"
          [disabled]="busy()"
          [class.app-icon-button]="compact"
          [attr.aria-label]="compact ? 'Search again' : null"
          [attr.title]="compact ? 'Search again' : null"
          (click)="execute('search')"
        >
          @if (compact) {
            <i class="pi pi-search" aria-hidden="true"></i>
          } @else {
            Search again
          }
        </button>
      }
      <ng-content select="[requestPrimary]" />
      @if (whisparrViewUrl) {
        <a
          class="app-baseline-button small"
          [class.app-icon-button]="compact"
          [href]="whisparrViewUrl"
          target="_blank"
          rel="noopener noreferrer"
          [attr.aria-label]="compact ? 'Open in Whisparr' : null"
          [attr.title]="compact ? 'Open in Whisparr' : null"
        >
          @if (compact) {
            <i class="pi pi-external-link" aria-hidden="true"></i>
          } @else {
            Open in Whisparr
          }
        </a>
      }
      <button
        class="app-baseline-button app-icon-button"
        type="button"
        aria-label="More request actions"
        title="More request actions"
        [disabled]="busy()"
        (click)="overflow.toggle($event)"
      >
        <i class="pi pi-ellipsis-v" aria-hidden="true"></i>
      </button>
      <p-menu
        #overflow
        [model]="overflowItems"
        [popup]="true"
        appendTo="body"
        styleClass="app-request-overflow"
      />
    </div>
    <app-request-diagnostics
      [sceneId]="sceneId"
      [sceneTitle]="sceneTitle"
      [showTrigger]="false"
      (changed)="changed.emit()"
    />
    @if (message()) {
      <p role="status">{{ message() }}</p>
    }
    <p-dialog
      styleClass="app-review-dialog"
      header="Delete request from Portal?"
      [visible]="deleteOpen()"
      (visibleChange)="deleteOpen.set($event)"
      [modal]="true"
      [blockScroll]="true"
      [appendTo]="'body'"
      [closable]="!busy()"
      [closeOnEscape]="!busy()"
      [style]="{ width: '32rem', maxWidth: '95vw' }"
    >
      <p>{{ sceneTitle }}</p>
      <p>
        This removes the request from Portal's active queue. Whisparr entries, downloads and media
        files remain unchanged. The history is kept, and you can restore the request.
      </p>
      <div class="app-action-row">
        <button
          class="app-baseline-button"
          type="button"
          [disabled]="busy()"
          (click)="execute('dismiss')"
        >
          {{ busy() ? 'Removing…' : 'Delete from Portal' }}
        </button>
        <button
          class="app-baseline-button"
          type="button"
          [disabled]="busy()"
          (click)="deleteOpen.set(false)"
        >
          Cancel
        </button>
      </div>
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
  @Input() compact = false;
  @Input() searchEnabled = true;
  @Input() whisparrViewUrl: string | null = null;
  @ViewChild(RequestDiagnosticsComponent) protected details!: RequestDiagnosticsComponent;
  protected get overflowItems(): MenuItem[] {
    return [
      {
        label: 'Item History',
        icon: 'pi pi-history',
        command: () => this.details.show(),
      },
      ...(this.tracked
        ? [
            {
              label: 'Delete request',
              icon: 'pi pi-trash',
              command: () => this.deleteOpen.set(true),
            },
          ]
        : []),
    ];
  }
  @Output() changed = new EventEmitter<void>();
  private readonly http = inject(HttpClient);
  protected readonly busy = signal(false);
  protected readonly requestOpen = signal(false);
  protected readonly deleteOpen = signal(false);
  protected readonly message = signal<string | null>(null);
  private keys = new Map<string, string>();
  protected execute(action: 'search' | 'dismiss'): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.message.set(null);
    const key = this.keys.get(action) ?? newOperationKey();
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
          if (action === 'dismiss') this.changed.emit();
        },
        error: (error) => {
          if (error.error?.actionState === 'FAILED' || (error.status && error.status !== 409))
            this.keys.delete(action);
          this.message.set(
            typeof error.error?.message === 'string'
              ? error.error.message
              : 'The result is unknown. Open Item History and check the outcome before retrying.',
          );
          this.details.show();
        },
      });
  }
}
