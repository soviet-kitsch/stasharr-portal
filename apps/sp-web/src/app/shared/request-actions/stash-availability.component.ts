import { Component, Input, OnChanges, OnDestroy, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Dialog } from 'primeng/dialog';
import { Subscription } from 'rxjs';
export interface StashAvailability {
  state: string;
  summary: string;
  checkedAt: string;
  libraryUrl: string | null;
  limitation: string;
  matches: { id: string; label: string; viewUrl: string; evidence: string }[];
}
@Component({
  selector: 'app-stash-availability',
  imports: [Dialog, DatePipe],
  styles: [
    `
      p {
        margin: 0.2rem 0;
        overflow-wrap: anywhere;
      }
      .copies {
        display: grid;
        gap: 0.5rem;
        max-height: 12rem;
        overflow: auto;
      }
      small {
        color: var(--text-muted);
      }
    `,
  ],
  template: `
    <p-dialog
      header="Stash availability"
      styleClass="app-review-dialog"
      [visible]="open()"
      (visibleChange)="close()"
      [modal]="true"
      [blockScroll]="true"
      [appendTo]="'body'"
      [style]="{ width: '32rem', maxWidth: '95vw' }"
    >
      <p>
        <strong>{{ sceneTitle }}</strong>
      </p>
      @if (loading()) {
        <p role="status">Checking Stash…</p>
      }
      @if (error()) {
        <p role="alert">{{ error() }}</p>
      }
      @if (result(); as value) {
        <p role="status">
          <strong>{{ statusLabel(value.state) }}</strong>
        </p>
        <p>{{ value.summary }}</p>
        <div class="copies">
          @for (match of value.matches; track match.id) {
            <div>
              <a
                class="app-baseline-button"
                [href]="match.viewUrl"
                target="_blank"
                rel="noopener noreferrer"
                >Open {{ match.label }}</a
              >
              <p>
                <small>{{
                  match.evidence === 'SOURCE_IDENTITY'
                    ? 'Matched source URL, studio and duration'
                    : 'Matched catalog ID'
                }}</small>
              </p>
            </div>
          }
        </div>
        <small>Checked {{ value.checkedAt | date: 'medium' }}</small>
        <small>{{ value.limitation }}</small>
      }
      <div class="app-action-row">
        <button class="app-baseline-button" type="button" [disabled]="loading()" (click)="check()">
          Check again
        </button>
        @if (result()?.libraryUrl; as url) {
          <a class="app-baseline-button" [href]="url" target="_blank" rel="noopener noreferrer"
            >Open Stash library</a
          >
        }
        <button class="app-baseline-button" type="button" (click)="close()">Close</button>
      </div>
    </p-dialog>
  `,
})
export class StashAvailabilityComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) sceneId = '';
  @Input() sceneTitle = '';
  protected readonly open = signal(false);
  protected readonly loading = signal(false);
  protected readonly result = signal<StashAvailability | null>(null);
  protected readonly error = signal<string | null>(null);
  private readonly http = inject(HttpClient);
  private request?: Subscription;
  private generation = 0;
  show() {
    this.open.set(true);
    this.check();
  }
  ngOnChanges() {
    this.close();
    this.result.set(null);
  }
  ngOnDestroy() {
    this.request?.unsubscribe();
  }
  protected close() {
    this.generation++;
    this.open.set(false);
    this.loading.set(false);
    this.request?.unsubscribe();
  }
  protected check() {
    if (!this.open() || this.loading()) return;
    const generation = ++this.generation;
    this.loading.set(true);
    this.result.set(null);
    this.error.set(null);
    this.request = this.http
      .get<StashAvailability>(
        `/api/acquisition/scenes/${encodeURIComponent(this.sceneId)}/stash-availability`,
      )
      .subscribe({
        next: (value) => {
          if (generation !== this.generation) return;
          this.result.set(value);
          this.loading.set(false);
        },
        error: () => {
          if (generation !== this.generation) return;
          this.loading.set(false);
          this.error.set('Current Stash availability could not be checked. Please retry.');
        },
      });
  }
  protected statusLabel(state: string) {
    return (
      (
        {
          AVAILABLE: 'Available in Stash',
          NOT_FOUND: 'No match found',
          NOT_CONFIGURED: 'Setup needed',
          UNAVAILABLE: 'Couldn’t verify',
        } as Record<string, string>
      )[state] ?? 'Couldn’t verify'
    );
  }
}
