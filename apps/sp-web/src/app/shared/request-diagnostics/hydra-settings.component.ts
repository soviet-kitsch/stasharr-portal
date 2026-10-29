import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { HydraSettings } from './hydra-search.util';

@Component({
  selector: 'app-hydra-settings',
  imports: [FormsModule],
  styles: [
    `
      :host {
        display: block;
        margin: 1.5rem 0;
        padding: 1.25rem;
        border: 1px solid var(--p-content-border-color);
        border-radius: 0.5rem;
      }
      label {
        display: block;
        margin: 0.75rem 0;
      }
      input[type='url'] {
        width: 100%;
        font: inherit;
        padding: 0.5rem;
      }
    `,
  ],
  template: `<h3>NZBHydra manual search</h3>
    <p>Browser address and default search terms. Your existing integrations stay connected.</p>
    @if (ready()) {
      <form (ngSubmit)="save()">
        <label
          >Browser URL
          <input
            type="url"
            name="browserUrl"
            [(ngModel)]="settings.browserUrl"
            placeholder="http://192.168.1.111:5076"
        /></label>
        <label
          ><input type="checkbox" name="studio" [(ngModel)]="settings.studio" /> Include
          studio</label
        >
        <label
          ><input type="checkbox" name="performers" [(ngModel)]="settings.performers" /> Include
          performers</label
        >
        <label
          ><input type="checkbox" name="title" [(ngModel)]="settings.title" /> Include scene
          title</label
        >
        <p>XXX is preselected. You can edit terms for each search.</p>
        <button class="app-baseline-button" type="submit" [disabled]="busy()">
          {{ busy() ? 'Saving…' : 'Save search settings' }}
        </button>
      </form>
    } @else {
      <button class="app-baseline-button" (click)="load()">Load Hydra search settings</button>
    }
    <p role="status">{{ message() }}</p>`,
})
export class HydraSettingsComponent implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly ready = signal(false);
  protected readonly busy = signal(false);
  protected readonly message = signal('');
  protected settings: HydraSettings = {
    browserUrl: '',
    studio: true,
    performers: true,
    title: false,
  };
  ngOnInit() {
    this.load();
  }
  protected load() {
    this.http.get<HydraSettings>('/api/settings/hydra-search').subscribe({
      next: (s) => {
        this.settings = s;
        this.ready.set(true);
      },
      error: () => this.message.set('Search settings could not be loaded.'),
    });
  }
  protected save() {
    if (this.busy()) return;
    this.busy.set(true);
    const { browserUrl, studio, performers, title } = this.settings;
    this.http
      .put<HydraSettings>('/api/settings/hydra-search', { browserUrl, studio, performers, title })
      .subscribe({
        next: (s) => {
          this.settings = s;
          this.busy.set(false);
          this.message.set('Search settings saved.');
        },
        error: () => {
          this.busy.set(false);
          this.message.set(
            'Could not save settings. Use an HTTP(S) browser address without credentials or query parameters.',
          );
        },
      });
  }
}
