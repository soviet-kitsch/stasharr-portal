import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  signal,
} from '@angular/core';
let nextTabId = 0;
export interface DeletionReviewItem {
  id: string;
  title: string;
  status?: string;
  message?: string;
  canCheckOutcome?: boolean;
  entryTarget?: { id: number; title: string; url: string } | null;
  target?: {
    whisparrSceneId: number;
    title: string;
    folder: string;
    files: { id: number; path: string; size: number }[];
    whisparrUrl: string;
  } | null;
}
@Component({
  selector: 'app-deletion-review',
  styles: [
    `
      .review-tabs {
        display: flex;
        gap: 0.35rem;
        border-bottom: 1px solid var(--p-content-border-color);
        margin-block: 0.5rem;
      }
      .review-tab {
        border-radius: 0.3rem 0.3rem 0 0;
        border-color: transparent;
        background: transparent;
      }
      .review-tab[aria-selected='true'] {
        border-bottom-color: currentColor;
      }
      [hidden] {
        display: none !important;
      }
      :host {
        display: block;
        min-width: 0;
      }
      .items {
        max-height: min(30vh, 13rem);
        overflow: auto;
      }
      article {
        padding: 0.5rem 0;
        border-bottom: 1px solid var(--p-content-border-color);
      }
      article:last-child {
        border-bottom: 0;
      }
      p {
        margin: 0.25rem 0;
        line-height: 1.4;
        overflow-wrap: anywhere;
      }
      .meta {
        font-size: 0.875rem;
        color: var(--p-text-muted-color);
      }
      ul {
        margin-block: 0.4rem;
        padding-left: 1.25rem;
        overflow-wrap: anywhere;
      }
      summary {
        cursor: pointer;
        font-size: 0.875rem;
      }
      .impact {
        font-size: 0.9rem;
      }
    `,
  ],
  template: `
    <div class="review-tabs" role="tablist" aria-label="Deletion review">
      <button
        class="app-baseline-button review-tab"
        type="button"
        role="tab"
        data-tab="items"
        [id]="id + '-items'"
        [attr.aria-controls]="id + '-items-panel'"
        [attr.aria-selected]="tab() === 'items'"
        [tabIndex]="tab() === 'items' ? 0 : -1"
        (click)="tab.set('items')"
        (keydown)="tabKey($event, 'items')"
      >
        Items ({{ items.length }})
      </button>
      <button
        class="app-baseline-button review-tab"
        type="button"
        role="tab"
        data-tab="impact"
        [id]="id + '-impact'"
        [attr.aria-controls]="id + '-impact-panel'"
        [attr.aria-selected]="tab() === 'impact'"
        [tabIndex]="tab() === 'impact' ? 0 : -1"
        (click)="tab.set('impact')"
        (keydown)="tabKey($event, 'impact')"
      >
        Impact
      </button>
    </div>
    <div
      role="tabpanel"
      [id]="id + '-items-panel'"
      [attr.aria-labelledby]="id + '-items'"
      [hidden]="tab() !== 'items'"
    >
      <div class="items" tabindex="0" aria-label="Reviewed deletion items">
        @for (item of items; track item.id) {
          <article>
            <p>
              <strong>{{ item.title }}</strong>
              @if (item.status) {
                · {{ item.status }}
              }
            </p>
            @if (item.message) {
              <p class="meta">{{ item.message }}</p>
            }
            @if (item.canCheckOutcome) {
              <button class="app-baseline-button" type="button" (click)="inspect.emit(item.id)">
                Item History
              </button>
            }
            @if (item.entryTarget; as target) {
              <a class="meta" [href]="target.url" target="_blank" rel="noopener noreferrer"
                >Whisparr #{{ target.id }} · {{ target.title }}</a
              >
              <p class="meta">Remove entry; keep all media files.</p>
            }
            @if (item.target; as target) {
              <p class="meta">Whisparr #{{ target.whisparrSceneId }} · {{ target.title }}</p>
              <p><strong>Entire scene folder:</strong> {{ target.folder }}</p>
              <details>
                <summary>{{ target.files.length }} known media files · scene ID</summary>
                <p class="meta">{{ item.id }}</p>
                <ul>
                  @for (file of target.files; track file.id) {
                    <li>{{ file.path }}</li>
                  }
                </ul>
              </details>
              <a class="meta" [href]="target.whisparrUrl" target="_blank" rel="noopener noreferrer"
                >Review in Whisparr</a
              >
            }
          </article>
        }
      </div>
    </div>
    <div
      role="tabpanel"
      [id]="id + '-impact-panel'"
      [attr.aria-labelledby]="id + '-impact'"
      [hidden]="tab() !== 'impact'"
      tabindex="0"
    >
      <div class="impact">
        <p>
          <strong>Portal:</strong> Remove the confirmed requests from the active queue. Keep
          history; tracking can be restored.
        </p>
        @if (deleteFiles) {
          <p>
            <strong>Whisparr & files:</strong> Remove each confirmed scene and its entire folder,
            including sidecars and other files inside. Cleanup runs asynchronously; a successful
            response does not prove the files are gone. Download-client jobs are unchanged.
          </p>
          <p>
            <strong>Stash:</strong> Keep catalog records. Records pointing to removed paths may lose
            file access; independent copies remain.
          </p>
          <p>
            <strong>Recovery:</strong> Whisparr uses its configured recycle bin if available;
            deletion may be permanent. Restoring a Portal request cannot restore files.
          </p>
          <p>
            <strong>Blocked or uncertain:</strong> Skip unverified matches. Stop on a failed or
            unknown deletion; check Item History before retrying. No automatic resend.
          </p>
        } @else if (deleteEntries) {
          <p>
            <strong>Whisparr:</strong> Delete the exact reviewed entries when present. No import
            exclusion is added. Entries with active transfers, ambiguous matches or failed checks
            are kept.
          </p>
          <p>
            <strong>Stash & files:</strong> Keep Stash records, media files, folders and
            download-client jobs. Whisparr file deletion is disabled.
          </p>
          <p>
            <strong>Recovery:</strong> A removed Whisparr entry must be added again if wanted later.
            Restoring a Portal request alone does not restore it. Uncertain results stop further
            cleanup; check Item History before retrying.
          </p>
        } @else {
          <p>
            <strong>Whisparr & Stash:</strong> Whisparr entries, downloads and media files remain
            unchanged. Stash records are kept.
          </p>
        }
      </div>
    </div>
  `,
})
export class DeletionReviewComponent implements OnChanges {
  protected readonly id = 'deletion-review-' + ++nextTabId;
  protected readonly tab = signal<'items' | 'impact'>('items');
  ngOnChanges(changes: SimpleChanges) {
    if (changes['deleteFiles']) this.tab.set('items');
  }
  protected tabKey(event: KeyboardEvent, current: 'items' | 'impact') {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const target =
      event.key === 'Home'
        ? 'items'
        : event.key === 'End'
          ? 'impact'
          : current === 'items'
            ? 'impact'
            : 'items';
    this.tab.set(target);
    (event.currentTarget as HTMLElement).parentElement
      ?.querySelector<HTMLElement>('[data-tab="' + target + '"]')
      ?.focus();
  }
  @Input() items: DeletionReviewItem[] = [];
  @Input() deleteFiles = false;
  @Input() deleteEntries = false;
  @Output() inspect = new EventEmitter<string>();
}
