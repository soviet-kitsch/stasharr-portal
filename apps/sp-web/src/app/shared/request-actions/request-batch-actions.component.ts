import { newOperationKey } from '../../core/api/operation-key';
import {
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
  signal,
  computed,
  ViewChild,
  ChangeDetectorRef,
  DestroyRef,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, concatMap, EMPTY, finalize, from, map, of, reduce, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DeletionReviewComponent, DeletionReviewItem } from './deletion-review.component';
import type { DeletionPreview } from './request-deletion.component';
import { RequestDiagnosticsComponent } from '../request-diagnostics/request-diagnostics.component';
import { requestOutcomeMessage } from './request-outcome';
import { Dialog } from 'primeng/dialog';
import { SubmitSceneRequestPayload } from '../../core/api/discover.types';
import { SceneRequestModalComponent } from '../scene-request-modal/scene-request-modal.component';

type Kind = 'RE_REQUEST' | 'SEARCH' | 'DISMISS';
interface Row {
  id: string;
  eligible?: boolean;
  ok?: boolean;
  message?: string;
  plannedAction?: string;
  requiresSettings?: boolean;
  target?: DeletionPreview;
  uncertain?: boolean;
  result?: { outcome?: string; alreadyExists?: boolean; message?: string };
}

@Component({
  selector: 'app-request-batch-actions',
  imports: [
    Dialog,
    SceneRequestModalComponent,
    DeletionReviewComponent,
    RequestDiagnosticsComponent,
  ],
  styleUrl: './request-actions.component.scss',
  template: `
    @if (scenes.length) {
      <div class="app-action-row batch-actions" role="region" aria-label="Selected requests">
        <span>{{ scenes.length }} selected</span>
        <button
          type="button"
          class="app-baseline-button secondary-action"
          [disabled]="busy()"
          (click)="preview('RE_REQUEST')"
        >
          Re-request selected
        </button>
        <button
          type="button"
          class="app-baseline-button secondary-action"
          [disabled]="busy()"
          (click)="preview('SEARCH')"
        >
          Search selected
        </button>
        <button
          type="button"
          class="app-baseline-button secondary-action"
          [disabled]="busy()"
          (click)="preview('DISMISS')"
        >
          Delete selected
        </button>
      </div>
    }
    <p-dialog
      [styleClass]="
        kind() === 'DISMISS' ? 'app-review-dialog app-deletion-dialog' : 'app-review-dialog'
      "
      [header]="
        kind() === 'DISMISS'
          ? deleteFiles()
            ? 'Delete requests, scenes & files?'
            : 'Delete selected requests?'
          : 'Review selected requests'
      "
      [visible]="open()"
      (visibleChange)="close($event)"
      (onHide)="afterHide()"
      [modal]="true"
      [blockScroll]="true"
      [appendTo]="'body'"
      [closable]="!busy()"
      [closeOnEscape]="!busy()"
      [style]="{ width: kind() === 'DISMISS' ? '36rem' : '44rem', maxWidth: '95vw' }"
    >
      @if (kind() === 'DISMISS') {
        <p class="deletion-summary">
          {{
            deleteFiles()
              ? 'Delete the reviewed scene folders. May be permanent.'
              : 'Remove selected requests from Portal only.'
          }}
        </p>
        <label class="deletion-choice">
          <input
            type="checkbox"
            [checked]="deleteFiles()"
            [disabled]="busy() || executionStarted"
            (change)="chooseDeletionFiles($any($event.target).checked)"
          />
          <span>Also delete scenes and their files from Whisparr</span>
        </label>
        @if (previewing()) {
          <p role="status">Checking {{ checkedCount() }} of {{ reviewedCount() }} scenes…</p>
        }
        @if (busy()) {
          <p role="status">Processing selected requests…</p>
        }
        <app-deletion-review
          [items]="reviewItems()"
          [deleteFiles]="deleteFiles()"
          (inspect)="inspect($event)"
        />
        @if (deleteFiles() && !completed()) {
          @if (!previewing()) {
            <p class="deletion-summary">
              {{ eligibleIds().length }} verified · {{ skippedCount() }} skipped
            </p>
          }
          <label class="deletion-choice">
            <input
              type="checkbox"
              [checked]="acknowledged()"
              [disabled]="busy() || previewing() || !eligibleIds().length"
              (change)="acknowledged.set($any($event.target).checked)"
            />
            <span
              >I reviewed the {{ eligibleIds().length }} scene folders and want Whisparr to delete
              them.</span
            >
          </label>
        }
      } @else {
        <p>
          {{
            kind() === 'DISMISS'
              ? 'Remove eligible requests from Portal only. Whisparr entries, downloads and files remain unchanged.'
              : kind() === 'SEARCH'
                ? 'Start one search per eligible entry. Existing monitoring settings remain unchanged.'
                : 'Resume each acquisition using the reviewed plan. Existing entries keep their settings. Creation settings apply only to entries that are still missing.'
          }}
        </p>
        @if (busy()) {
          <p role="status">{{ completed() ? 'Retrieving results…' : 'Checking requests…' }}</p>
        }
        @for (row of rows(); track row.id) {
          <p>
            <strong>{{ title(row.id) }}</strong
            >:
            {{ completed() ? resultStatus(row) : row.eligible ? 'Eligible' : 'Skipped' }}
            — {{ row.message ?? outcome(row) }}
          </p>
        }
      }
      @if (error()) {
        <p role="alert">{{ error() }}</p>
      }
      <div class="app-action-row">
        @if (kind() === 'DISMISS' && deleteFiles() && !completed()) {
          <button
            class="app-baseline-button"
            type="button"
            [disabled]="busy() || previewing()"
            (click)="previewDeletionFiles()"
          >
            Refresh previews
          </button>
        }
        @if (!completed()) {
          @if (kind() === 'RE_REQUEST' && requiresSettings()) {
            <button
              class="app-baseline-button"
              type="button"
              [disabled]="busy()"
              (click)="settingsOpen.set(true)"
            >
              {{ settings() ? 'Review settings again' : 'Choose acquisition settings' }}
            </button>
          }
          <button
            class="app-baseline-button"
            type="button"
            [disabled]="
              busy() ||
              previewing() ||
              (deleteFiles() && !acknowledged()) ||
              !eligibleIds().length ||
              (kind() === 'RE_REQUEST' && requiresSettings() && !settings())
            "
            (click)="confirm()"
          >
            @if (kind() === 'DISMISS' && deleteFiles()) {
              Delete {{ eligibleIds().length }} scenes & files
            } @else {
              Confirm {{ eligibleIds().length }}
              {{ kind() === 'DISMISS' ? 'deletions from Portal' : 'actions' }}
            }
          </button>
        }
        <button
          class="app-baseline-button"
          type="button"
          [disabled]="busy()"
          (click)="close(false)"
        >
          {{ completed() ? 'Done' : 'Cancel' }}
        </button>
      </div>
    </p-dialog>
    <app-request-diagnostics
      [sceneId]="historyId()"
      [sceneTitle]="title(historyId())"
      [showTrigger]="false"
    />
    <app-scene-request-modal
      [open]="settingsOpen()"
      [sceneId]="settingsSceneId()"
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
  protected readonly requiresSettings = computed(() =>
    this.rows().some((row) => row.eligible && row.requiresSettings !== false),
  );
  protected readonly settingsSceneId = computed(
    () => this.rows().find((row) => row.eligible && row.requiresSettings !== false)?.id ?? null,
  );
  private key = '';
  protected executionStarted = false;
  protected readonly deleteFiles = signal(false);
  protected readonly acknowledged = signal(false);
  protected readonly previewing = signal(false);
  protected readonly historyId = signal('');
  protected readonly checkedCount = computed(
    () => this.rows().filter((r) => r.target || r.message !== 'Checking…').length,
  );
  protected readonly reviewedCount = computed(() => this.rows().length);
  protected readonly skippedCount = computed(() => this.rows().filter((r) => !r.eligible).length);
  protected readonly reviewItems = computed<DeletionReviewItem[]>(() =>
    this.rows().map((row) => ({
      id: row.id,
      title: this.title(row.id),
      target: row.target,
      status: this.completed()
        ? row.ok
          ? 'Completed'
          : row.uncertain
            ? 'Check outcome'
            : row.ok === false
              ? 'Not completed'
              : row.eligible
                ? 'Not sent'
                : 'Skipped'
        : row.eligible
          ? 'Eligible'
          : row.message === 'Checking…'
            ? 'Checking'
            : 'Skipped',
      message:
        row.ok && this.deleteFiles()
          ? 'Scene removed; file cleanup requested, not verified.'
          : (row.message ?? this.outcome(row)),
      canCheckOutcome: row.uncertain,
    })),
  );
  @ViewChild(RequestDiagnosticsComponent) private history!: RequestDiagnosticsComponent;
  private readonly changes = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private pendingHistory = '';
  private previewGeneration = 0;
  private reviewedScenes: Array<{ id: string; title: string }> = [];
  protected title(id: string) {
    return this.reviewedScenes.find((scene) => scene.id === id)?.title ?? id;
  }
  protected resultStatus(row: Row): string {
    if (!row.ok) return 'Not completed';
    if (
      ['NEEDS_IDENTIFICATION', 'IMPORT_PENDING', 'UPSTREAM_BLOCKED'].includes(
        row.result?.outcome ?? '',
      )
    )
      return 'Needs review';
    if (['ALREADY_QUEUED', 'ALREADY_SEARCHING'].includes(row.result?.outcome ?? ''))
      return 'Active';
    if (row.result?.outcome === 'ALREADY_AVAILABLE') return 'Available';
    return 'Completed';
  }

  protected outcome(row: Row) {
    return (
      row.result?.message ||
      requestOutcomeMessage(row.result?.outcome) ||
      (row.result?.alreadyExists ? 'Already present; no duplicate was sent.' : '')
    );
  }

  protected preview(kind: Kind): void {
    if (this.busy() || !this.scenes.length) return;
    this.previewGeneration++;
    this.previewing.set(false);
    this.deleteFiles.set(false);
    this.acknowledged.set(false);
    this.reviewedScenes = this.scenes.map((scene) => ({ ...scene }));
    this.key = newOperationKey();
    this.kind.set(kind);
    this.open.set(true);
    this.busy.set(true);
    this.completed.set(false);
    this.executionStarted = false;
    this.error.set(null);
    this.rows.set([]);
    this.settings.set(null);
    this.eligibleIds.set([]);
    this.runBatches(
      '/api/requests/batch/preview',
      this.reviewedScenes.map((scene) => scene.id),
    )
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (value) => {
          this.rows.set(value);
          this.eligibleIds.set(value.filter((row) => row.eligible).map((row) => row.id));
        },
        error: () => this.error.set('Could not verify this selection. No actions were taken.'),
      });
  }

  protected confirm(): void {
    if (this.deleteFiles()) {
      this.confirmSceneDeletions();
      return;
    }
    if (
      this.busy() ||
      !this.eligibleIds().length ||
      (this.kind() === 'RE_REQUEST' && this.requiresSettings() && !this.settings())
    )
      return;
    this.busy.set(true);
    this.error.set(null);
    this.executionStarted = true;
    this.runBatches('/api/requests/batch/execute', [...this.eligibleIds()], this.settings())
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (value) => {
          this.rows.set(value);
          this.completed.set(true);
        },
        error: () =>
          this.error.set(
            'Results could not be confirmed. Retry this same reviewed batch to recover its recorded results, or inspect each request history.',
          ),
      });
  }

  protected chooseDeletionFiles(value: boolean): void {
    if (this.busy() || this.executionStarted) return;
    if (!value) {
      // Restore the same frozen selection even if the table selection changed underneath.
      const current = this.scenes;
      this.scenes = this.reviewedScenes;
      this.preview('DISMISS');
      this.scenes = current;
      return;
    }
    this.deleteFiles.set(true);
    this.previewDeletionFiles();
  }
  protected previewDeletionFiles(): void {
    if (this.busy() || this.executionStarted || !this.deleteFiles()) return;
    const generation = ++this.previewGeneration;
    const scenes = this.reviewedScenes.map((s) => ({ ...s }));
    this.rows.set(scenes.map((s) => ({ id: s.id, eligible: false, message: 'Checking…' })));
    this.eligibleIds.set([]);
    this.error.set(null);
    this.acknowledged.set(false);
    this.previewing.set(true);
    from(scenes)
      .pipe(
        concatMap((scene) =>
          generation !== this.previewGeneration
            ? EMPTY
            : this.http
                .get<DeletionPreview>(
                  `/api/requests/${encodeURIComponent(scene.id)}/whisparr-deletion-preview`,
                )
                .pipe(
                  map((target) => ({ id: scene.id, eligible: true, target }) as Row),
                  catchError((err) =>
                    of({
                      id: scene.id,
                      eligible: false,
                      message:
                        typeof err.error?.message === 'string'
                          ? err.error.message
                          : 'Match could not be verified. Request kept.',
                    } as Row),
                  ),
                ),
        ),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          if (generation === this.previewGeneration) this.previewing.set(false);
        }),
      )
      .subscribe((row) => {
        if (generation !== this.previewGeneration) return;
        this.rows.update((rows) => rows.map((r) => (r.id === row.id ? row : r)));
        this.eligibleIds.set(
          this.rows()
            .filter((r) => r.eligible)
            .map((r) => r.id),
        );
      });
  }
  private confirmSceneDeletions(): void {
    if (
      this.busy() ||
      this.previewing() ||
      this.executionStarted ||
      !this.acknowledged() ||
      !this.eligibleIds().length
    )
      return;
    const eligible = this.rows().filter((r) => r.eligible);
    if (
      eligible.some(
        (r) =>
          !r.target ||
          !Number.isFinite(Date.parse(r.target.expiresAt)) ||
          Date.parse(r.target.expiresAt) <= Date.now(),
      )
    ) {
      this.acknowledged.set(false);
      this.error.set('A preview expired. Refresh the previews and review the folders again.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.executionStarted = true;
    let stopped = false;
    from(eligible)
      .pipe(
        concatMap((row) =>
          stopped
            ? EMPTY
            : this.http
                .post<{ outcome?: string; message?: string }>(
                  `/api/requests/${encodeURIComponent(row.id)}/delete-whisparr`,
                  {
                    operationKey: newOperationKey(),
                    previewToken: row.target!.previewToken,
                    confirmDeleteFiles: true,
                  },
                )
                .pipe(
                  tap((result) => {
                    if (result.outcome !== 'WHISPARR_SCENE_REMOVED')
                      throw new Error('Unconfirmed deletion response');
                    this.rows.update((rows) =>
                      rows.map((r) => (r.id === row.id ? { ...r, ok: true, result } : r)),
                    );
                  }),
                  catchError((err) => {
                    stopped = true;
                    const message =
                      typeof err.error?.message === 'string'
                        ? err.error.message
                        : 'Result unknown. Check Item History before retrying.';
                    this.rows.update((rows) =>
                      rows.map((r) =>
                        r.id === row.id
                          ? {
                              ...r,
                              eligible: false,
                              ok: false,
                              uncertain: err.error?.actionState !== 'FAILED',
                              message,
                            }
                          : r,
                      ),
                    );
                    this.error.set(
                      'Batch stopped. Completed items are kept; later items were not sent. Check uncertain items in Item History. Select remaining items for a fresh review.',
                    );
                    return EMPTY;
                  }),
                ),
        ),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.busy.set(false);
          this.completed.set(true);
        }),
      )
      .subscribe();
  }
  protected inspect(id: string): void {
    if (this.busy()) return;
    this.pendingHistory = id;
    this.close(false);
  }
  protected afterHide(): void {
    if (!this.pendingHistory) return;
    this.historyId.set(this.pendingHistory);
    this.pendingHistory = '';
    this.changes.detectChanges();
    this.history.show();
  }

  private runBatches(endpoint: string, ids: string[], settings?: SubmitSceneRequestPayload | null) {
    const groups = Array.from({ length: Math.ceil(ids.length / 20) }, (_, index) =>
      ids.slice(index * 20, index * 20 + 20),
    );
    return from(groups).pipe(
      concatMap((ids) =>
        this.http
          .post<{ results: Row[] }>(endpoint, {
            kind: this.kind(),
            ids,
            operationKey: this.key,
            ...(settings ? { settings } : {}),
          })
          .pipe(
            map((value) => {
              if (
                !Array.isArray(value.results) ||
                value.results.length !== ids.length ||
                new Set(value.results.map((row) => row.id)).size !== ids.length ||
                value.results.some((row) => !ids.includes(row.id))
              )
                throw new Error('Incomplete batch results');
              return value.results;
            }),
          ),
      ),
      reduce((all, rows) => [...all, ...rows], [] as Row[]),
    );
  }

  protected close(visible: boolean): void {
    if (visible || this.busy()) return;
    const changed = this.executionStarted;
    this.previewGeneration++;
    this.previewing.set(false);
    this.open.set(false);
    if (changed) this.finished.emit();
  }
}
