import { Injectable, inject, signal } from '@angular/core';
import { AuthStatusResponse } from './auth.types';
import { FeedStateCache } from '../navigation/feed-state-memory';

@Injectable({
  providedIn: 'root',
})
export class AuthStateStore {
  private readonly feedCache = inject(FeedStateCache);
  private readonly statusState = signal<AuthStatusResponse | null>(null);

  readonly status = this.statusState.asReadonly();

  sync(status: AuthStatusResponse): void {
    if (!status.authenticated || this.statusState()?.username !== status.username) {
      this.feedCache.invalidateAll();
    }
    this.statusState.set(status);
  }

  clear(): void {
    this.feedCache.invalidateAll();
    this.statusState.set(null);
  }
}
