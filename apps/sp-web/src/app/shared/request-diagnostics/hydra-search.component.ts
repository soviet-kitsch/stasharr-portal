import { Component, Input, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Dialog } from 'primeng/dialog';
import { forkJoin } from 'rxjs';
import { HydraSettings, HydraTerms, hydraLink, hydraQuery } from './hydra-search.util';

@Component({
  selector: 'app-hydra-search',
  imports: [Dialog, FormsModule, RouterLink, NgTemplateOutlet],
  styles: [
    `
      label {
        display: block;
        margin: 0.65rem 0;
      }
      textarea {
        width: 100%;
        min-height: 5rem;
        font: inherit;
      }
      .app-action-row {
        margin-top: 1rem;
      }
    `,
  ],
  template: ` <button class="app-baseline-button small" type="button" (click)="show()">
      Search Hydra
    </button>
    <ng-template #searchBody>
      <div class="hydra-body">
        <p>{{ sceneTitle }}</p>
        @if (loading()) {
          <p role="status">Loading search terms…</p>
        }
        @if (error()) {
          <p role="alert">{{ error() }}</p>
        }
        @if (settings && terms) {
          <label
            ><input
              type="checkbox"
              [(ngModel)]="studio"
              (ngModelChange)="regenerateUnlessEdited()"
              [disabled]="!terms.studio"
            />
            Studio: {{ terms.studio || 'Not supplied' }}</label
          >
          <label
            ><input
              type="checkbox"
              [ngModel]="selectedPerformers.length > 0"
              (ngModelChange)="choosePerformers($event)"
            />
            Performers</label
          >
          @for (name of terms.performers; track name) {
            <label
              ><input
                type="checkbox"
                [checked]="selectedPerformers.includes(name)"
                (change)="togglePerformer(name)"
              />
              {{ name }}</label
            >
          }
          @if (!terms.performers.length) {
            <p>No performers supplied by the catalog.</p>
          }
          <label
            ><input
              type="checkbox"
              [(ngModel)]="title"
              (ngModelChange)="regenerateUnlessEdited()"
              [disabled]="!terms.title"
            />
            Scene title</label
          >
          <label
            >Search terms <textarea [(ngModel)]="query" (ngModelChange)="edited = true"></textarea>
          </label>
          @if (edited) {
            <p>
              Your edited query is kept. Choose Regenerate terms to apply the current checkboxes
              again.
            </p>
          }
          <p>
            Category: <strong>XXX</strong>. Opens an editable Hydra search form. Starting the search
            there uses your indexers.
          </p>
          <div class="app-action-row">
            <button class="app-baseline-button" (click)="regenerate()">Regenerate terms</button>
            @if (link(); as url) {
              <a class="app-baseline-button" [href]="url" target="_blank" rel="noopener noreferrer"
                >Open NZBHydra</a
              >
            } @else {
              <p>Set the Hydra browser URL in Settings → Integrations and enter search terms.</p>
            }
            <a
              class="app-baseline-button"
              routerLink="/settings/acquisition"
              (click)="open.set(false)"
              >Search settings</a
            >
          </div>
        }
      </div>
    </ng-template>
    @if (inline) {
      @if (open()) {
        <section class="inline-search" aria-label="NZBHydra search options">
          <h4>Search NZBHydra</h4>
          <button class="app-baseline-button" (click)="open.set(false)">
            Close search options
          </button>
          <ng-container [ngTemplateOutlet]="searchBody" />
        </section>
      }
    } @else {
      <p-dialog
        header="Search NZBHydra"
        styleClass="app-review-dialog"
        [visible]="open()"
        (visibleChange)="open.set($event)"
        [modal]="true"
        [appendTo]="'body'"
        [style]="{ width: '36rem', maxWidth: '95vw' }"
      >
        <ng-container [ngTemplateOutlet]="searchBody" />
      </p-dialog>
    }`,
})
export class HydraSearchComponent {
  @Input() inline = false;
  @Input({ required: true }) sceneId = '';
  @Input() sceneTitle = '';
  private readonly http = inject(HttpClient);
  protected readonly open = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected settings: HydraSettings | null = null;
  protected terms: HydraTerms | null = null;
  protected studio = true;
  protected title = false;
  protected selectedPerformers: string[] = [];
  protected query = '';
  protected edited = false;
  protected show() {
    this.open.set(true);
    this.loading.set(true);
    this.error.set('');
    this.settings = null;
    this.terms = null;
    const id = this.sceneId;
    forkJoin({
      settings: this.http.get<HydraSettings>('/api/settings/hydra-search'),
      terms: this.http.get<HydraTerms>('/api/requests/' + encodeURIComponent(id) + '/hydra-terms'),
    }).subscribe({
      next: ({ settings, terms }) => {
        if (id !== this.sceneId) return;
        this.settings = settings;
        this.terms = terms;
        this.studio = settings.studio;
        this.title = settings.title;
        this.selectedPerformers = settings.performers ? [...terms.performers] : [];
        this.regenerate();
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Could not load search terms. Check the catalog connection and retry.');
      },
    });
  }
  protected regenerate() {
    if (!this.terms) return;
    this.edited = false;
    this.query = hydraQuery(this.terms, {
      studio: this.studio,
      title: this.title,
      performers: this.selectedPerformers,
    });
  }
  protected regenerateUnlessEdited() {
    if (!this.edited) this.regenerate();
  }
  protected choosePerformers(on: boolean) {
    this.selectedPerformers = on ? [...this.terms!.performers] : [];
    this.regenerateUnlessEdited();
  }
  protected togglePerformer(name: string) {
    this.selectedPerformers = this.selectedPerformers.includes(name)
      ? this.selectedPerformers.filter((n) => n !== name)
      : [...this.selectedPerformers, name];
    this.regenerateUnlessEdited();
  }
  protected link() {
    return hydraLink(this.settings?.browserUrl ?? '', this.query);
  }
}
