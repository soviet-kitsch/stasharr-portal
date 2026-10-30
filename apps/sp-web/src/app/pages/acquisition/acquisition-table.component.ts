import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpParams } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom, Subscription } from 'rxjs';
import {
  AcquisitionSceneItem,
  AcquisitionCountsByLifecycle,
} from '../../core/api/acquisition.types';
import { RequestActionsComponent } from '../../shared/request-actions/request-actions.component';
import { RequestBatchActionsComponent } from '../../shared/request-actions/request-batch-actions.component';

interface Row extends AcquisitionSceneItem {
  diagnostics: { code: string; label: string; detail: string };
  requestedAt: string;
  activityAt: string;
  checkedAt: string | null;
  performers: string[];
}
interface Table {
  items: Row[];
  total: number;
  trackedCount: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  countsByLifecycle: AcquisitionCountsByLifecycle;
  blockerCounts: Record<string, number>;
  hydraConfigured: boolean;
  selectionVersion: string;
}

@Component({
  selector: 'app-acquisition-table',
  imports: [
    DatePipe,
    FormsModule,
    RouterLink,
    RequestActionsComponent,
    RequestBatchActionsComponent,
  ],
  templateUrl: './acquisition-table.component.html',
  styleUrl: './acquisition-table.component.scss',
})
export class AcquisitionTableComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly data = signal<Table | null>(null);
  protected readonly loading = signal(false);
  protected readonly selecting = signal(false);
  protected readonly message = signal('');
  private readonly failedThumbnails = signal(new Set<string>());
  protected thumbnail(row: Row): string | null {
    const image = row.cardImageUrl || row.imageUrl;
    return image && !this.failedThumbnails().has(image) ? image : null;
  }
  protected thumbnailFailed(image: string): void {
    this.failedThumbnails.update((failed) => new Set([...failed, image]));
  }
  protected readonly selected = signal<Row[]>([]);
  protected readonly stages = [
    { id: 'ANY', label: 'All tracked' },
    { id: 'REQUESTED', label: 'Requested' },
    { id: 'DOWNLOADING', label: 'Downloading' },
    { id: 'IMPORT_PENDING', label: 'Awaiting Import' },
    { id: 'FAILED', label: 'Failed' },
  ];
  protected readonly blockers = [
    { id: 'NEEDS_ATTENTION', label: 'Needs attention' },
    { id: 'UNKNOWN', label: 'No search history' },
    { id: 'NO_CANDIDATES', label: 'No candidates' },
    { id: 'ALL_REJECTED', label: 'Rejected' },
    { id: 'INCOMPLETE', label: 'Search incomplete' },
    { id: 'STATUS_UNAVAILABLE', label: 'Status needs refresh' },
    { id: 'WAITING_FOR_STASH_MATCH', label: 'Stash match' },
    { id: 'ORPHANED_REQUEST', label: 'Missing in Whisparr' },
  ];
  protected stage = 'ANY';
  protected q = '';
  protected blocker = '';
  protected sort = 'ATTENTION';
  protected page = 1;
  private generation = 0;
  private selectionGeneration = 0;
  private timer?: ReturnType<typeof setInterval>;
  private sub?: Subscription;
  ngOnInit() {
    this.sub = this.route.queryParamMap.subscribe((params) => {
      const stage = params.get('lifecycle') ?? 'ANY',
        sort = params.get('sort') ?? 'ATTENTION',
        blocker = params.get('blocker') ?? '';
      const q = params.get('q') ?? '';
      const scopeChanged =
        stage !== this.stage || q !== this.q || blocker !== this.blocker || sort !== this.sort;
      if (scopeChanged) this.clear();
      this.stage = this.stages.some((s) => s.id === stage) ? stage : 'ANY';
      this.q = q.slice(0, 160);
      this.blocker = this.blockers.some((b) => b.id === blocker) ? blocker : '';
      this.sort = ['ATTENTION', 'OLDEST', 'ACTIVITY'].includes(sort) ? sort : 'ATTENTION';
      this.page = Math.max(1, Math.floor(Number(params.get('page')) || 1));
      this.load();
    });
    this.timer = setInterval(() => {
      if (!this.loading() && !this.selecting()) this.load();
    }, 15_000);
  }
  private params(page = this.page, perPage = 24) {
    const params = new HttpParams()
      .set('page', page)
      .set('perPage', perPage)
      .set('lifecycle', this.stage)
      .set('sort', this.sort)
      .set('q', this.q);
    return this.blocker ? params.set('blocker', this.blocker) : params;
  }
  protected load() {
    const generation = ++this.generation;
    this.loading.set(true);
    let params = this.params();
    if (!this.blocker) params = params.delete('blocker');
    this.http.get<Table>('/api/acquisition/table', { params }).subscribe({
      next: (data) => {
        if (generation !== this.generation) return;
        this.data.set(data);
        this.loading.set(false);
        if (!data.items.length && data.total && this.page > 1)
          this.navigate(Math.ceil(data.total / data.perPage));
      },
      error: () => {
        if (generation !== this.generation) return;
        this.loading.set(false);
        this.message.set(
          'The acquisition overview could not be refreshed. Previous observations are retained.',
        );
      },
    });
  }
  protected apply() {
    this.clear();
    this.navigate(1);
  }
  protected chooseStage(id: string) {
    this.stage = id;
    this.apply();
  }
  protected chooseBlocker(id: string) {
    this.blocker = this.blocker === id ? '' : id;
    this.apply();
  }
  protected navigate(page: number) {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        lifecycle: this.stage === 'ANY' ? null : this.stage,
        q: this.q || null,
        blocker: this.blocker || null,
        sort: this.sort === 'ATTENTION' ? null : this.sort,
        page: page === 1 ? null : page,
      },
    });
  }
  protected label(stage: string) {
    return this.stages.find((s) => s.id === stage)?.label ?? stage;
  }
  protected routerUrl() {
    return this.router.url;
  }
  protected count(stage: string) {
    const data = this.data();
    return !data
      ? 0
      : stage === 'ANY'
        ? data.trackedCount
        : data.countsByLifecycle[stage as keyof AcquisitionCountsByLifecycle];
  }
  protected selectedRow(id: string) {
    return this.selected().some((r) => r.id === id);
  }
  protected toggle(row: Row) {
    this.selected.update((rows) =>
      rows.some((r) => r.id === row.id) ? rows.filter((r) => r.id !== row.id) : [...rows, row],
    );
  }
  protected clear() {
    this.selectionGeneration++;
    this.selecting.set(false);
    this.selected.set([]);
  }
  protected pageSelected() {
    return (
      !!this.data()?.items.length && this.data()!.items.every((row) => this.selectedRow(row.id))
    );
  }
  protected togglePage() {
    const rows = this.data()?.items ?? [];
    const remove = this.pageSelected();
    const ids = new Set(rows.map((r) => r.id));
    this.selected.update((current) =>
      remove
        ? current.filter((r) => !ids.has(r.id))
        : [...new Map([...current, ...rows].map((r) => [r.id, r])).values()],
    );
  }
  protected async selectAll() {
    if (this.selecting()) return;
    const version = ++this.selectionGeneration;
    this.selecting.set(true);
    const rows = new Map<string, Row>();
    let snapshot: string | undefined;
    try {
      for (let page = 1; page <= 200; page++) {
        let params = this.params(page, 50);
        if (!this.blocker) params = params.delete('blocker');
        const response = await firstValueFrom(
          this.http.get<Table>('/api/acquisition/table', { params }),
        );
        if (version !== this.selectionGeneration) return;
        if (snapshot && snapshot !== response.selectionVersion) throw new Error('Queue changed');
        snapshot = response.selectionVersion;
        if (response.page !== page || (response.hasMore && !response.items.length))
          throw new Error('Incomplete selection');
        for (const row of response.items) {
          if (rows.has(row.id)) throw new Error('Queue changed');
          rows.set(row.id, row);
        }
        if (!response.hasMore) {
          if (rows.size !== response.total) throw new Error('Queue changed');
          this.selected.set([...rows.values()]);
          return;
        }
      }
      throw new Error('Selection too large');
    } catch {
      if (version === this.selectionGeneration)
        this.message.set(
          'Could not select all matching requests. Previous selection is unchanged; refresh and retry.',
        );
    } finally {
      if (version === this.selectionGeneration) this.selecting.set(false);
    }
  }
  protected refresh() {
    if (this.loading()) return;
    this.loading.set(true);
    this.message.set('Refreshing service observations…');
    this.http.post('/api/indexing/sync', {}, { params: { job: 'acquisition' } }).subscribe({
      next: () => {
        this.http.post('/api/acquisition/diagnostics/refresh', {}).subscribe({
          next: () => {
            this.message.set('Observations refreshed.');
            this.load();
          },
          error: () => {
            this.message.set('Some diagnostic observations could not be refreshed.');
            this.load();
          },
        });
      },
      error: () => {
        this.message.set(
          'Refresh did not finish. Check integrations or retry after the current sync.',
        );
        this.load();
      },
    });
  }
  protected actionsFinished() {
    this.clear();
    this.load();
  }
  ngOnDestroy() {
    this.generation++;
    this.clear();
    clearInterval(this.timer);
    this.sub?.unsubscribe();
  }
}
