import { Component, EventEmitter, Input, OnChanges, Output, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Dialog } from 'primeng/dialog';
import { DeletionReviewComponent } from './deletion-review.component';
import { newOperationKey } from '../../core/api/operation-key';

export interface DeletionPreview {
  whisparrSceneId: number;
  title: string;
  folder: string;
  files: { id: number; path: string; size: number }[];
  expiresAt: string;
  previewToken: string;
  whisparrUrl: string;
  recovery: string;
}
@Component({
  selector: 'app-request-deletion',
  imports: [Dialog, DeletionReviewComponent],
  styles: [
    `
      .choice {
        display: flex;
        gap: 0.6rem;
        align-items: flex-start;
        margin-block: 0.25rem;
        font-size: 0.9rem;
      }
      .choice input {
        flex: none;
        margin-top: 0.2rem;
      }
      .summary {
        margin: 0.2rem 0;
        font-size: 0.9rem;
      }
      .error {
        color: var(--p-red-500);
        overflow-wrap: anywhere;
      }
    `,
  ],
  template: `
    <p-dialog
      styleClass="app-review-dialog app-deletion-dialog"
      [header]="deleteFiles() ? 'Delete request, scene & files?' : 'Delete request from Portal?'"
      [visible]="open"
      (visibleChange)="close()"
      (onHide)="afterHide()"
      [modal]="true"
      [blockScroll]="true"
      [appendTo]="'body'"
      [closable]="!busy()"
      [closeOnEscape]="!busy()"
      [style]="{ width: '34rem', maxWidth: '95vw' }"
    >
      <p class="summary">
        {{
          deleteFiles()
            ? 'Delete the reviewed scene folder. May be permanent.'
            : 'Remove this request from Portal only.'
        }}
      </p>
      <label class="choice">
        <input
          type="checkbox"
          [checked]="deleteFiles()"
          [disabled]="busy() || uncertain()"
          (change)="chooseFiles($any($event.target).checked)"
        />
        <span>Also delete the scene and its files from Whisparr</span>
      </label>
      @if (loading()) {
        <p class="summary" role="status">Checking the Whisparr match and files…</p>
      }
      <app-deletion-review
        [items]="[{ id: sceneId, title: sceneTitle, target: preview() }]"
        [deleteFiles]="deleteFiles()"
      />
      @if (deleteFiles() && preview()) {
        <label class="choice">
          <input
            type="checkbox"
            [checked]="acknowledged()"
            [disabled]="busy() || uncertain()"
            (change)="acknowledged.set($any($event.target).checked)"
          />
          <span>I reviewed this scene and folder and want Whisparr to delete them.</span>
        </label>
      }
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
      <div class="app-action-row">
        @if (!uncertain()) {
          <button
            class="app-baseline-button"
            type="button"
            [disabled]="busy() || (deleteFiles() && (!preview() || !acknowledged() || loading()))"
            (click)="submit()"
          >
            {{
              busy()
                ? 'Removing…'
                : deleteFiles()
                  ? 'Delete request, scene & files'
                  : 'Delete from Portal'
            }}
          </button>
          @if (deleteFiles()) {
            <button
              class="app-baseline-button"
              type="button"
              [disabled]="busy() || loading()"
              (click)="loadPreview()"
            >
              Refresh preview
            </button>
          }
        } @else {
          <button class="app-baseline-button" type="button" (click)="checkOutcome()">
            Check in Item History
          </button>
        }
        <button class="app-baseline-button" type="button" [disabled]="busy()" (click)="close()">
          Cancel
        </button>
      </div>
    </p-dialog>
  `,
})
export class RequestDeletionComponent implements OnChanges {
  @Input() open = false;
  @Input({ required: true }) sceneId!: string;
  @Input() sceneTitle = '';
  @Output() closed = new EventEmitter<void>();
  @Output() removed = new EventEmitter<string>();
  @Output() needsOutcome = new EventEmitter<void>();
  protected readonly deleteFiles = signal(false);
  protected readonly acknowledged = signal(false);
  protected readonly preview = signal<DeletionPreview | null>(null);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly uncertain = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly http = inject(HttpClient);
  private generation = 0;
  private historyAfterHide = false;
  ngOnChanges() {
    this.generation++;
    this.deleteFiles.set(false);
    this.acknowledged.set(false);
    this.preview.set(null);
    this.loading.set(false);
    this.uncertain.set(false);
    this.error.set(null);
  }
  protected chooseFiles(value: boolean) {
    this.generation++;
    this.deleteFiles.set(value);
    this.preview.set(null);
    this.acknowledged.set(false);
    this.error.set(null);
    this.loading.set(false);
    if (value) this.loadPreview();
  }
  protected loadPreview() {
    if (this.busy() || this.uncertain()) return;
    const generation = ++this.generation;
    this.preview.set(null);
    this.acknowledged.set(false);
    this.error.set(null);
    this.loading.set(true);
    this.http
      .get<DeletionPreview>(
        `/api/requests/${encodeURIComponent(this.sceneId)}/whisparr-deletion-preview`,
      )
      .subscribe({
        next: (value) => {
          if (generation !== this.generation) return;
          this.loading.set(false);
          this.preview.set(value);
        },
        error: (err) => {
          if (generation !== this.generation) return;
          this.loading.set(false);
          this.error.set(
            this.errorMessage(
              err,
              'The Whisparr match could not be verified. Portal-only deletion is still available.',
            ),
          );
        },
      });
  }
  protected submit() {
    if (this.busy() || this.uncertain()) return;
    const target = this.preview();
    const withFiles = this.deleteFiles();
    if (withFiles && (!target || !this.acknowledged() || this.loading())) return;
    if (withFiles && Date.parse(target!.expiresAt) <= Date.now()) {
      this.preview.set(null);
      this.acknowledged.set(false);
      this.error.set('The preview expired. Refresh it and review the folder again.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    const endpoint = withFiles ? 'delete-whisparr' : 'dismiss';
    const body = withFiles
      ? {
          operationKey: newOperationKey(),
          previewToken: target!.previewToken,
          confirmDeleteFiles: true,
        }
      : { operationKey: newOperationKey() };
    this.http
      .post<{
        message?: string;
      }>(`/api/requests/${encodeURIComponent(this.sceneId)}/${endpoint}`, body)
      .subscribe({
        next: (result) => {
          this.busy.set(false);
          this.removed.emit(
            result.message ?? 'Removed from Portal. Downloads and files were preserved.',
          );
          this.close();
        },
        error: (err) => {
          this.busy.set(false);
          this.error.set(
            this.errorMessage(err, 'The result is unknown. Check Item History before retrying.'),
          );
          // Only an explicit NOT_SENT/FAILED response permits a fresh attempt.
          this.uncertain.set(err.error?.actionState !== 'FAILED');
          this.preview.set(null);
          this.acknowledged.set(false);
        },
      });
  }
  protected close() {
    if (this.busy()) return;
    this.generation++;
    this.closed.emit();
  }
  protected checkOutcome() {
    this.historyAfterHide = true;
    this.close();
  }
  protected afterHide() {
    if (this.historyAfterHide) {
      this.historyAfterHide = false;
      this.needsOutcome.emit();
    }
  }
  private errorMessage(err: any, fallback: string) {
    return typeof err.error?.message === 'string' ? err.error.message : fallback;
  }
}
