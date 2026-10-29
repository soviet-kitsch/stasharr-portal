import { Component, inject } from '@angular/core';
import { FullscreenService } from '../../core/display/fullscreen.service';

@Component({
  selector: 'app-fullscreen-toggle',
  styles: [
    `
      button {
        inline-size: 2.1rem;
        block-size: 2.1rem;
        display: inline-grid;
        place-items: center;
        border-radius: 999px;
        border: 1px solid var(--border-strong);
        background: var(--surface-elevated);
        color: var(--text-primary);
        box-shadow: var(--shadow-sm);
        padding: 0;
        cursor: pointer;
        font-size: 0.9rem;
      }
      button:hover {
        background: var(--surface-raised);
      }
      button:focus-visible {
        outline: 2px solid var(--focus-ring);
        outline-offset: 2px;
      }
      .fullscreen-message {
        position: fixed;
        right: 0.75rem;
        top: 3.25rem;
        max-width: min(22rem, 90vw);
        padding: 0.65rem;
        background: var(--surface-elevated);
        color: var(--text-primary);
        border: 1px solid var(--border-strong);
        border-radius: 0.4rem;
        font-size: 0.85rem;
      }
    `,
  ],
  template: `<button
      type="button"
      [disabled]="fullscreen.busy()"
      [attr.aria-label]="fullscreen.active() ? 'Exit fullscreen' : 'Enter fullscreen'"
      [title]="fullscreen.active() ? 'Exit fullscreen' : 'Enter fullscreen'"
      [attr.aria-pressed]="fullscreen.active()"
      (click)="fullscreen.toggle()"
    >
      <i
        class="pi"
        [class.pi-expand]="!fullscreen.active()"
        [class.pi-window-minimize]="fullscreen.active()"
        aria-hidden="true"
      ></i>
    </button>
    @if (fullscreen.message()) {
      <p class="fullscreen-message" role="status">{{ fullscreen.message() }}</p>
    }`,
})
export class FullscreenToggleComponent {
  protected readonly fullscreen = inject(FullscreenService);
}
