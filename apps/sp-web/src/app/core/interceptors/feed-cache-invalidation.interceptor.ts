import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { finalize } from 'rxjs';
import { FeedStateCache } from '../navigation/feed-state-memory';

/** Remember layout during browsing, but never replay observations after a write. */
export const feedCacheInvalidationInterceptor: HttpInterceptorFn = (request, next) => {
  const cache = inject(FeedStateCache);
  const path = request.url.split('?')[0];
  const changesFeed =
    request.method !== 'GET' &&
    request.method !== 'HEAD' &&
    !path.endsWith('/preview') &&
    (/^\/api\/requests(?:\/|$)/.test(path) ||
      /^\/api\/(?:scenes|performers|studios)\/.*\/favorite$/.test(path) ||
      /^\/api\/integrations(?:\/|$)/.test(path) ||
      path === '/api/indexing/sync');
  return changesFeed
    ? // A failed response can follow an uncertain external submission. Reloading is
      // safer than restoring a stale request button even when the write failed.
      next(request).pipe(finalize(() => cache.invalidateAll()))
    : next(request);
};
