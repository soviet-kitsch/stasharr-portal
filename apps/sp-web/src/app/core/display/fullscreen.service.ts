import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';

type OrientationControl = {
  lock?: (orientation: 'landscape') => Promise<void>;
  unlock?: () => void;
};

@Injectable({ providedIn: 'root' })
export class FullscreenService {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  readonly active = signal(false);
  readonly busy = signal(false);
  readonly message = signal('');
  private orientationOwned = false;
  private generation = 0;
  private readonly changed = () => {
    this.active.set(!!this.document.fullscreenElement);
    if (!this.document.fullscreenElement) {
      this.generation++;
      this.releaseOrientation();
      this.message.set('');
    }
  };

  constructor() {
    this.document.addEventListener('fullscreenchange', this.changed);
    this.active.set(!!this.document.fullscreenElement);
    this.destroyRef.onDestroy(() => {
      this.generation++;
      this.document.removeEventListener('fullscreenchange', this.changed);
      this.releaseOrientation();
    });
  }

  private orientation(): OrientationControl | undefined {
    return this.document.defaultView?.screen?.orientation as OrientationControl | undefined;
  }
  private mobile() {
    const view = this.document.defaultView;
    if (!view) return false;
    return (
      (view.navigator.maxTouchPoints > 0 ||
        view.matchMedia?.('(pointer: coarse)').matches === true) &&
      Math.min(view.screen.width || view.innerWidth, view.screen.height || view.innerHeight) <= 1024
    );
  }
  private releaseOrientation() {
    if (!this.orientationOwned) return;
    try {
      this.orientation()?.unlock?.();
    } catch {
      /* The browser may already have released it. */
    }
    this.orientationOwned = false;
  }

  async toggle() {
    if (this.busy()) return;
    this.busy.set(true);
    this.message.set('');
    const generation = ++this.generation;
    try {
      if (this.document.fullscreenElement) {
        await this.document.exitFullscreen();
        this.changed();
        return;
      }
      if (!this.document.documentElement.requestFullscreen) {
        this.message.set('Fullscreen is not available in this browser.');
        return;
      }
      // Call directly from the user gesture before any other asynchronous work.
      await this.document.documentElement.requestFullscreen();
      this.active.set(!!this.document.fullscreenElement);
      if (generation !== this.generation || !this.active() || !this.mobile()) return;
      const orientation = this.orientation();
      if (!orientation?.lock) {
        this.message.set('Fullscreen on. Rotate your device for landscape.');
        return;
      }
      try {
        await orientation.lock('landscape');
        this.orientationOwned = true;
        if (generation !== this.generation || !this.document.fullscreenElement)
          this.releaseOrientation();
      } catch {
        if (this.document.fullscreenElement)
          this.message.set('Fullscreen on. Rotate your device for landscape.');
      }
    } catch {
      this.message.set(
        'The browser could not enter fullscreen. You can use its fullscreen controls.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
