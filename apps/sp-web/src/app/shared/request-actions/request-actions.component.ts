import { StashAvailabilityComponent } from './stash-availability.component';
import { newOperationKey } from '../../core/api/operation-key';
import { RequestDiagnosticsComponent } from '../request-diagnostics/request-diagnostics.component';
import { Component, EventEmitter, Input, Output, ViewChild, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { finalize } from 'rxjs';
import { RequestDeletionComponent } from './request-deletion.component';
import { ResponsiveActionsComponent, RowAction } from './responsive-actions.component';
import { HydraSearchComponent } from '../request-diagnostics/hydra-search.component';
import { ImportMatchReviewComponent } from '../import-match-review/import-match-review.component';
import { SceneRequestModalComponent } from '../scene-request-modal/scene-request-modal.component';

@Component({
  selector: 'app-request-actions',
  imports: [
    RequestDeletionComponent,
    StashAvailabilityComponent,
    ResponsiveActionsComponent,
    HydraSearchComponent,
    ImportMatchReviewComponent,
    SceneRequestModalComponent,
    RequestDiagnosticsComponent,
  ],
  styleUrl: './request-actions.component.scss',
  template: `
    <div class="request-actions">
      <app-responsive-actions [actions]="rowActions" [compact]="compact" />
    </div>
    @if (hydraAvailable) {
      <app-hydra-search [sceneId]="sceneId" [sceneTitle]="sceneTitle" [showTrigger]="false" />
    }
    @if (importReviewAvailable) {
      <app-import-match-review
        [sceneId]="sceneId"
        [showTrigger]="false"
        (reconciled)="changed.emit()"
      />
    }
    <app-stash-availability [sceneId]="sceneId" [sceneTitle]="sceneTitle" />
    <app-request-diagnostics
      [sceneId]="sceneId"
      [sceneTitle]="sceneTitle"
      [showTrigger]="false"
      (changed)="changed.emit()"
    />
    @if (message()) {
      <p role="status">{{ message() }}</p>
    }
    <app-request-deletion
      [open]="deleteOpen()"
      [sceneId]="sceneId"
      [sceneTitle]="sceneTitle"
      (closed)="deleteOpen.set(false)"
      (removed)="deleted($event)"
      (needsOutcome)="details.show()"
    />
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
  @Input() hydraAvailable = false;
  @Input() importReviewAvailable = false;
  @ViewChild(StashAvailabilityComponent) private availability?: StashAvailabilityComponent;
  @ViewChild(HydraSearchComponent) private hydra?: HydraSearchComponent;
  @ViewChild(ImportMatchReviewComponent) private matchReview?: ImportMatchReviewComponent;
  protected get rowActions(): RowAction[] {
    const actions: RowAction[] = [];
    if (this.tracked)
      actions.push({
        key: 'rerequest',
        label: 'Re-request',
        icon: 'pi pi-cloud-download',
        disabled: this.busy(),
        run: () => this.requestOpen.set(true),
      });
    if (
      this.tracked &&
      this.searchEnabled &&
      (!this.condition || this.condition === 'WAITING_FOR_RELEASE')
    )
      actions.push({
        key: 'search',
        label: 'Search again',
        icon: 'pi pi-search',
        disabled: this.busy(),
        run: () => this.execute('search'),
      });
    if (this.importReviewAvailable)
      actions.push({
        key: 'stash',
        label: 'Review Stash match',
        icon: 'pi pi-database',
        run: () => this.matchReview?.show(),
      });
    if (this.hydraAvailable)
      actions.push({
        key: 'hydra',
        label: 'Search Hydra',
        icon: 'pi pi-globe',
        run: () => this.hydra?.show(),
      });
    if (this.whisparrViewUrl)
      actions.push({
        key: 'whisparr',
        label: 'Open in Whisparr',
        icon: 'pi pi-external-link',
        href: this.whisparrViewUrl,
      });
    actions.push({
      key: 'stash-availability',
      label: 'Check Stash availability',
      icon: 'pi pi-check-circle',
      run: () => this.availability?.show(),
    });
    actions.push({
      key: 'history',
      label: 'Item History',
      icon: 'pi pi-history',
      disabled: this.busy(),
      run: () => this.details.show(),
    });
    if (this.tracked)
      actions.push({
        key: 'delete',
        label: 'Delete request',
        icon: 'pi pi-trash',
        disabled: this.busy(),
        run: () => this.deleteOpen.set(true),
      });
    return actions;
  }
  @Output() changed = new EventEmitter<void>();
  private readonly http = inject(HttpClient);
  protected readonly busy = signal(false);
  protected readonly requestOpen = signal(false);
  protected readonly deleteOpen = signal(false);
  protected readonly message = signal<string | null>(null);
  protected deleted(message: string) {
    this.message.set(message);
    this.changed.emit();
  }
  private keys = new Map<string, string>();
  protected execute(action: 'search'): void {
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
