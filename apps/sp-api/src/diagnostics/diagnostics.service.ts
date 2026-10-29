import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  IntegrationStatus,
  Prisma,
  RequestSearchAttempt,
  SceneIndex,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationsService } from '../integrations/integrations.service';
import {
  normalizeBrowserUrl,
  integrationBrowserBaseUrl,
} from '../integrations/browser-url.util';
import { IndexingService } from '../indexing/indexing.service';
import { reconcileAcquisition } from '../acquisition/acquisition-reconciliation';
import { WhisparrAdapter } from '../providers/whisparr/whisparr.adapter';
import { RequestOperationsService } from '../requests/request-operations.service';
import { CatalogProviderService } from '../providers/catalog/catalog-provider.service';
import { StashdbAdapter } from '../providers/stashdb/stashdb.adapter';
import {
  evidenceId,
  parseDecisions,
  safeText,
  shortStatus,
} from './diagnostics.util';
import { DiagnosticTableQuery, HydraSettingsDto } from './diagnostics.dto';

const stages = [
  'REQUESTED',
  'DOWNLOADING',
  'IMPORT_PENDING',
  'FAILED',
] as const;
const active = ['queued', 'started', 'running'];

@Injectable()
export class DiagnosticsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DiagnosticsService.name);
  private syncing = false;
  private readonly workers = new Set<Promise<unknown>>();
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly indexing: IndexingService,
    private readonly whisparr: WhisparrAdapter,
    private readonly operations: RequestOperationsService,
    private readonly catalog: CatalogProviderService,
    private readonly stashdb: StashdbAdapter,
  ) {}

  async onApplicationBootstrap() {
    // A previous process may have dispatched a native search. Never replay it.
    await this.prisma.requestSearchAttempt.updateMany({
      where: { mode: 'DIAGNOSTIC', state: { in: ['RUNNING', 'QUEUED'] } },
      data: { state: 'UNCERTAIN', outcome: 'INCOMPLETE' },
    });
    void this.observe().catch(() =>
      this.logger.warn('Request diagnostics observation unavailable.'),
    );
  }

  private async config() {
    const config = await this.integrations
      .findOne('WHISPARR')
      .catch((error) => {
        if (error instanceof NotFoundException) return null;
        throw error;
      });
    if (
      !config ||
      !config.enabled ||
      config.status !== IntegrationStatus.CONFIGURED ||
      !config.baseUrl
    )
      throw new BadRequestException(
        'Configure Whisparr before checking request diagnostics.',
      );
    return config;
  }

  private source(config: { id: string; baseUrl: string | null }) {
    return evidenceId('WHISPARR', config.id, config.baseUrl);
  }

  private async commandObservations(config: {
    baseUrl: string | null;
    apiKey: string | null;
  }) {
    const rows = await this.native(config, 'command');
    if (!Array.isArray(rows))
      throw new BadGatewayException('Command snapshot incomplete.');
    return rows
      .filter((c) => c?.name === 'MoviesSearch')
      .map((c) => {
        if (
          !Number.isInteger(c.id) ||
          typeof c.status !== 'string' ||
          !Array.isArray(c.body?.movieIds) ||
          !c.body.movieIds.every(Number.isInteger)
        )
          throw new BadGatewayException('Command identity incomplete.');
        const date = (value: unknown) =>
          typeof value === 'string' && Number.isFinite(Date.parse(value))
            ? new Date(value)
            : null;
        return {
          id: c.id as number,
          status: c.status as string,
          movieIds: c.body.movieIds as number[],
          queued: date(c.queued),
          started: date(c.started),
          ended: date(c.ended),
        };
      });
  }

  private async native(
    config: { baseUrl: string | null; apiKey: string | null },
    path: string,
    timeout = 30_000,
  ): Promise<any> {
    const url = new URL(
      config.baseUrl!.replace(/\/+$/, '') + '/api/v3/' + path,
    );
    const response = await fetch(url, {
      headers: { 'X-Api-Key': config.apiKey ?? '' },
      signal: AbortSignal.timeout(timeout),
      redirect: 'error',
    });
    if (!response.ok)
      throw new BadGatewayException('Whisparr diagnostics could not be read.');
    const reader = response.body?.getReader();
    if (!reader) throw new BadGatewayException('Empty Whisparr response.');
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8 * 1024 * 1024)
          throw new BadGatewayException(
            'Whisparr response was too large to verify.',
          );
        parts.push(value);
      }
      return JSON.parse(Buffer.concat(parts).toString('utf8'));
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }

  @Interval(15_000)
  async tick() {
    await this.observe().catch(() =>
      this.logger.warn('Request diagnostics observation unavailable.'),
    );
  }

  async observe() {
    if (this.syncing) return;
    this.syncing = true;
    let source: string | undefined;
    try {
      await this.capturePortalActions();
      const config = await this.config();
      source = this.source(config);
      const [commands, movies] = await Promise.all([
        this.commandObservations(config),
        this.whisparr.getMovieSnapshot({
          baseUrl: config.baseUrl!,
          apiKey: config.apiKey,
        }),
      ]);
      const identities = new Map(movies.map((m) => [m.movieId, m.stashId]));
      const now = new Date();
      for (const c of commands) {
        for (const movieId of c.movieIds) {
          const stashId = identities.get(movieId);
          if (!stashId) continue;
          const id = evidenceId(source, c.id, movieId, stashId);
          const createdAt = c.queued ?? now;
          await this.prisma.requestSearchAttempt.upsert({
            where: { id },
            create: {
              id,
              stashId,
              source,
              movieId,
              commandId: c.id,
              mode: 'AUTOMATIC',
              state: c.status,
              createdAt,
              finishedAt: c.ended,
              outcome: ['failed', 'aborted', 'cancelled'].includes(
                c.status.toLowerCase(),
              )
                ? 'INCOMPLETE'
                : 'UNKNOWN',
            },
            update: {
              state: c.status,
              ...(c.ended ? { finishedAt: c.ended } : {}),
              outcome: ['failed', 'aborted', 'cancelled'].includes(
                c.status.toLowerCase(),
              )
                ? 'INCOMPLETE'
                : 'UNKNOWN',
            },
          });
          const nativeTime =
            c.status.toLowerCase() === 'queued'
              ? c.queued
              : ['started', 'running'].includes(c.status.toLowerCase())
                ? c.started
                : c.ended;
          await this.event(
            stashId,
            source,
            'SEARCH',
            `${nativeTime ? '' : 'Observed: '}Whisparr search ${safeText(c.status, 40)}; release decisions not retained`,
            nativeTime ?? now,
            [c.id, movieId, c.status],
          );
        }
      }
      const sync = await this.prisma.requestDiagnosticSync.upsert({
        where: { source },
        create: { source, since: new Date(Date.now() - 30 * 86400_000) },
        update: {},
      });
      const history = await this.native(
        config,
        'history/since?date=' +
          encodeURIComponent(
            new Date(sync.since.getTime() - 300_000).toISOString(),
          ),
      );
      if (
        !Array.isArray(history) ||
        history.length > 5000 ||
        history.some(
          (h) =>
            !Number.isInteger(h?.id) ||
            !Number.isInteger(h?.movieId) ||
            !Number.isFinite(Date.parse(h?.date)) ||
            typeof h?.eventType !== 'string',
        )
      )
        throw new BadGatewayException(
          'History incomplete; previous checkpoint retained.',
        );
      const labels: Record<string, string> = {
        grabbed: 'Release grabbed',
        downloadFailed: 'Download failed',
        downloadFolderImported: 'File imported in Whisparr',
        movieFileDeleted: 'Whisparr file record removed',
        movieFileRenamed: 'Whisparr file renamed',
        downloadIgnored: 'Download ignored',
        movieFileImported: 'File imported in Whisparr',
      };
      await this.prisma.$transaction(async (tx) => {
        for (const h of history) {
          const stashId = identities.get(h.movieId);
          const label = labels[h.eventType];
          if (!stashId || !label) continue;
          const id = evidenceId(source, 'HISTORY', h.id, stashId);
          await tx.requestDiagnosticEvent.upsert({
            where: { id },
            create: {
              id,
              stashId,
              source: source!,
              kind: h.eventType,
              label,
              occurredAt: new Date(h.date),
            },
            update: {},
          });
        }
        await tx.requestDiagnosticSync.update({
          where: { source: source! },
          data: { since: now, checkedAt: now, error: null },
        });
      });
      // Capture observed pipeline transitions and Portal actions without a browser being open.
      let cursor: string | undefined;
      for (;;) {
        const rows = await this.prisma.sceneIndex.findMany({
          where: { computedLifecycle: { in: [...stages] } },
          take: 100,
          orderBy: { stashId: 'asc' },
          ...(cursor ? { cursor: { stashId: cursor }, skip: 1 } : {}),
        });
        if (!rows.length) break;
        for (const row of rows) await this.project(row, source);
        cursor = rows.at(-1)!.stashId;
        if (rows.length < 100) break;
      }
      // Requests that became available still get a final observation.
      const completed = await this.prisma.sceneIndex.findMany({
        where: {
          computedLifecycle: 'AVAILABLE',
          diagnostics: { is: { code: { not: 'AVAILABLE' } } },
        },
        take: 100,
      });
      for (const row of completed) await this.project(row, source);
      await this.hydratePerformers().catch(() =>
        this.logger.warn('Request performer metadata backfill deferred.'),
      );
    } catch (error) {
      if (source)
        await this.prisma.requestDiagnosticSync.updateMany({
          where: { source },
          data: {
            error: 'Observation incomplete; previous evidence retained.',
          },
        });
      throw error;
    } finally {
      this.syncing = false;
    }
  }

  private async event(
    stashId: string,
    source: string,
    kind: string,
    label: string,
    occurredAt: Date,
    key: unknown,
  ) {
    const id = evidenceId(source, stashId, kind, key);
    return this.prisma.requestDiagnosticEvent.upsert({
      where: { id },
      create: { id, stashId, source, kind, label, occurredAt },
      update: {},
    });
  }

  private async capturePortalActions() {
    const source = 'PORTAL';
    const now = new Date();
    const sync = await this.prisma.requestDiagnosticSync.upsert({
      where: { source },
      create: { source, since: new Date(0) },
      update: {},
    });
    let cursor: { updatedAt: Date; id: string } | undefined;
    for (;;) {
      const actions = await this.prisma.requestAction.findMany({
        where: {
          updatedAt: {
            gte: new Date(Math.max(0, sync.since.getTime() - 300_000)),
            lte: now,
          },
          ...(cursor
            ? {
                OR: [
                  { updatedAt: { gt: cursor.updatedAt } },
                  { updatedAt: cursor.updatedAt, id: { gt: cursor.id } },
                ],
              }
            : {}),
        },
        take: 500,
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      });
      for (const action of actions) {
        await this.event(
          action.stashId,
          source,
          'ACTION_CREATED',
          `${action.kind.replaceAll('_', ' ')} submitted in Portal`,
          action.createdAt,
          action.id,
        );
        await this.event(
          action.stashId,
          source,
          'ACTION',
          `${action.kind.replaceAll('_', ' ')}: ${action.state.toLowerCase()}`,
          action.updatedAt,
          [action.id, action.state],
        );
      }
      if (actions.length < 500) break;
      cursor = { updatedAt: actions.at(-1)!.updatedAt, id: actions.at(-1)!.id };
    }
    await this.prisma.requestDiagnosticSync.update({
      where: { source },
      data: { since: now, checkedAt: now, error: null },
    });
  }

  private async project(row: SceneIndex, source: string) {
    const [prior, attempt, actions, evidence, request, latestEvent] =
      await Promise.all([
        this.prisma.requestDiagnosticObservation.findUnique({
          where: { stashId: row.stashId },
        }),
        this.prisma.requestSearchAttempt.findFirst({
          where: { stashId: row.stashId, source },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
        this.prisma.requestAction.findMany({
          where: { stashId: row.stashId },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
        this.indexing.getAcquisitionEvidence(),
        this.prisma.request.findUnique({
          where: { stashId: row.stashId },
          select: { createdAt: true },
        }),
        this.prisma.requestDiagnosticEvent.findFirst({
          where: { stashId: row.stashId, source: { in: [source, 'PORTAL'] } },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        }),
      ]);
    for (const action of actions)
      await this.event(
        row.stashId,
        'PORTAL',
        'ACTION',
        `${action.kind.replaceAll('_', ' ')}: ${action.state.toLowerCase()}`,
        action.updatedAt,
        [action.id, action.state],
      );
    const reconciliation = reconcileAcquisition(row, evidence);
    const status = shortStatus(reconciliation.condition, attempt);
    const signature = evidenceId(
      row.computedLifecycle,
      reconciliation.condition,
      row.whisparrMovieId,
      row.stashAvailable,
      row.whisparrErrorMessage,
    );
    const changed = prior?.signature !== signature || prior.source !== source;
    if (changed)
      await this.event(
        row.stashId,
        source,
        'OBSERVED',
        `Observed: ${reconciliation.label}`,
        new Date(),
        [signature, prior?.signature, prior?.activityAt],
      );
    const activityAt = new Date(
      Math.max(
        changed ? Date.now() : prior!.activityAt.getTime(),
        attempt?.finishedAt?.getTime() ?? attempt?.createdAt.getTime() ?? 0,
        latestEvent?.occurredAt.getTime() ?? 0,
        ...actions.map((a) => a.updatedAt.getTime()),
      ),
    );
    const detail = [
      attempt
        ? `${attempt.mode === 'DIAGNOSTIC' ? 'Diagnostic' : 'Whisparr'} search: ${attempt.candidateCount === null ? 'result count unknown' : `${attempt.candidateCount} evaluated candidates`}`
        : 'No retained search evidence',
      reconciliation.message,
    ].join('. ');
    const data = {
      source,
      signature,
      checkedAt: new Date(),
      activityAt,
      requestedAt: request?.createdAt ?? null,
      code: status.code,
      label: status.label,
      detail,
      priority:
        reconciliation.needsAttention ||
        ['ALL_REJECTED', 'INCOMPLETE'].includes(status.code)
          ? 0
          : row.computedLifecycle === 'REQUESTED'
            ? 1
            : 2,
    };
    await this.prisma.requestDiagnosticObservation.upsert({
      where: { stashId: row.stashId },
      create: { stashId: row.stashId, ...data },
      update: data,
    });
  }

  async details(stashId: string, eventBefore?: string, attemptBefore?: string) {
    const config = await this.integrations
      .findOne('WHISPARR')
      .catch(() => null);
    const source = config ? this.source(config) : '';
    const row = await this.prisma.sceneIndex.findUnique({
      where: { stashId },
      include: { diagnostics: true },
    });
    const parseCursor = (value?: string) => {
      if (!value) return undefined;
      try {
        const cursor = JSON.parse(Buffer.from(value, 'base64url').toString());
        if (
          typeof cursor.id !== 'string' ||
          !/^[a-f0-9-]{30,70}$/.test(cursor.id) ||
          !Number.isFinite(Date.parse(cursor.at))
        )
          throw new Error();
        return { id: cursor.id as string, at: new Date(cursor.at) };
      } catch {
        throw new BadRequestException('Invalid history cursor.');
      }
    };
    const eventBoundary = parseCursor(eventBefore),
      attemptBoundary = parseCursor(attemptBefore);
    const [events, attempts, sync, request] = await Promise.all([
      this.prisma.requestDiagnosticEvent.findMany({
        where: {
          stashId,
          ...(eventBoundary
            ? {
                OR: [
                  { occurredAt: { lt: eventBoundary.at } },
                  {
                    occurredAt: eventBoundary.at,
                    id: { lt: eventBoundary.id },
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: 51,
      }),
      this.prisma.requestSearchAttempt.findMany({
        where: {
          stashId,
          ...(attemptBoundary
            ? {
                OR: [
                  { createdAt: { lt: attemptBoundary.at } },
                  {
                    createdAt: attemptBoundary.at,
                    id: { lt: attemptBoundary.id },
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 51,
      }),
      this.prisma.requestDiagnosticSync.findUnique({ where: { source } }),
      this.prisma.request.findUnique({
        where: { stashId },
        select: { createdAt: true, activeActionId: true },
      }),
    ]);
    const evidence = await this.indexing.getAcquisitionEvidence();
    const reconciliation = row ? reconcileAcquisition(row, evidence) : null;
    const summary = row?.diagnostics
      ? {
          ...row.diagnostics,
          ...(reconciliation &&
          reconciliation.condition !== 'WAITING_FOR_RELEASE'
            ? {
                ...shortStatus(reconciliation.condition),
                detail: reconciliation.message,
              }
            : {}),
          ...(Date.now() - row.diagnostics.checkedAt.getTime() > 120_000
            ? { code: 'STATUS_UNAVAILABLE', label: 'Diagnostics need refresh' }
            : {}),
        }
      : null;
    return {
      sceneId: stashId,
      summary,
      request,
      events: events.slice(0, 50),
      attempts: attempts.slice(0, 50).map((a) => ({
        ...a,
        currentIntegration: a.source === source,
        needsReview:
          a.mode === 'DIAGNOSTIC' &&
          request?.activeActionId === a.id &&
          !['QUEUED', 'RUNNING'].includes(a.state),
      })),
      hasMoreEvents: events.length > 50,
      hasMoreAttempts: attempts.length > 50,
      sync,
      nextEventCursor:
        events.length > 50
          ? Buffer.from(
              JSON.stringify({ id: events[49].id, at: events[49].occurredAt }),
            ).toString('base64url')
          : undefined,
      nextAttemptCursor:
        attempts.length > 50
          ? Buffer.from(
              JSON.stringify({
                id: attempts[49].id,
                at: attempts[49].createdAt,
              }),
            ).toString('base64url')
          : undefined,
      whisparrUrl:
        row?.whisparrMovieId && config?.baseUrl
          ? this.whisparr.buildSceneViewUrl(
              integrationBrowserBaseUrl(config) ?? config.baseUrl,
              row.whisparrMovieId,
            )
          : null,
      limitations: [
        'Automatic command history does not retain release counts or rejection decisions. An empty command list does not prove no search occurred.',
        'Diagnostic searches are fresh interactive searches and may use different indexers from automatic searches. Indexer coverage and raw hit counts are not established by the release response.',
        'Native history backfill begins at most 30 days before observation started; earlier or uncorrelated events may be unavailable.',
      ],
    };
  }

  async start(stashId: string, operationKey: string) {
    const existing = await this.prisma.requestSearchAttempt.findUnique({
      where: { id: operationKey },
    });
    if (existing) {
      if (existing.stashId !== stashId || existing.mode !== 'DIAGNOSTIC')
        throw new ConflictException('Operation key belongs to another search.');
      return existing;
    }
    const config = await this.config();
    const source = this.source(config);
    const [movie, commands] = await Promise.all([
      this.whisparr.findMovieByStashId(stashId, {
        baseUrl: config.baseUrl!,
        apiKey: config.apiKey,
      }),
      this.whisparr.getSearchCommands({
        baseUrl: config.baseUrl!,
        apiKey: config.apiKey,
      }),
    ]);
    if (!movie || movie.hasFile)
      throw new ConflictException(
        'Review the existing file or request the scene in Whisparr first.',
      );
    if (
      commands.some(
        (c) =>
          c.movieIds.includes(movie.movieId) &&
          active.includes(c.status.toLowerCase()),
      )
    )
      throw new ConflictException(
        'Whisparr is already searching for this scene.',
      );
    let created: RequestSearchAttempt;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(734229)`;
        const recent = await tx.requestSearchAttempt.findMany({
          where: {
            mode: 'DIAGNOSTIC',
            createdAt: { gt: new Date(Date.now() - 3600_000) },
          },
        });
        if (
          recent.length >= 10 ||
          recent.some(
            (a) =>
              a.stashId === stashId &&
              a.createdAt.getTime() > Date.now() - 60_000,
          )
        )
          throw new ConflictException(
            'Diagnostic search limit reached. Wait before searching again.',
          );
        return tx.requestSearchAttempt.create({
          data: {
            id: operationKey,
            stashId,
            source,
            movieId: movie.movieId,
            mode: 'DIAGNOSTIC',
            state: 'QUEUED',
          },
        });
      });
    } catch (e) {
      if (e instanceof ConflictException) throw e;
      throw new ConflictException(
        'Another diagnostic search is running or needs its outcome reviewed.',
      );
    }
    const job = this.operations
      .run(
        stashId,
        operationKey,
        'DIAGNOSTIC_SEARCH',
        { source, movieId: movie.movieId },
        async (dispatch) => {
          const currentConfig = await this.config();
          if (this.source(currentConfig) !== source)
            throw new ConflictException(
              'The integration changed before searching.',
            );
          const [currentMovie, currentCommands] = await Promise.all([
            this.whisparr.findMovieByStashId(stashId, {
              baseUrl: config.baseUrl!,
              apiKey: config.apiKey,
            }),
            this.whisparr.getSearchCommands({
              baseUrl: config.baseUrl!,
              apiKey: config.apiKey,
            }),
          ]);
          if (
            !currentMovie ||
            currentMovie.movieId !== movie.movieId ||
            currentMovie.hasFile ||
            currentCommands.some(
              (c) =>
                c.movieIds.includes(movie.movieId) &&
                active.includes(c.status.toLowerCase()),
            )
          )
            throw new ConflictException(
              'The scene or running search changed. Refresh before retrying.',
            );
          await this.prisma.requestSearchAttempt.update({
            where: { id: operationKey },
            data: { state: 'RUNNING' },
          });
          await dispatch({
            operation: 'DIAGNOSTIC_SEARCH',
            movieId: movie.movieId,
          });
          try {
            const decisions = parseDecisions(
              await this.native(
                config,
                `release?movieId=${movie.movieId}`,
                120_000,
              ),
            );
            await this.prisma.requestSearchAttempt.update({
              where: { id: operationKey },
              data: {
                ...decisions,
                candidates:
                  decisions.candidates as unknown as Prisma.InputJsonValue,
                state: 'COMPLETED',
                finishedAt: new Date(),
              },
            });
            return { outcome: 'DIAGNOSTIC_COMPLETE' };
          } catch {
            await this.prisma.requestSearchAttempt.update({
              where: { id: operationKey },
              data: { state: 'UNCERTAIN', outcome: 'INCOMPLETE' },
            });
            throw new BadGatewayException(
              'Diagnostic search was not confirmed. Check its outcome before starting another.',
            );
          }
        },
      )
      .catch(async () => {
        // An unsent action (e.g. an existing acquisition claim) does not own a native search.
        const action = await this.prisma.requestAction.findUnique({
          where: { id: operationKey },
        });
        if (!action?.dispatchedAt)
          await this.prisma.requestSearchAttempt.updateMany({
            where: { id: operationKey, state: { in: ['QUEUED', 'RUNNING'] } },
            data: {
              state: 'FAILED',
              outcome: 'INCOMPLETE',
              finishedAt: new Date(),
            },
          });
      })
      .finally(async () => {
        this.workers.delete(job);
        const row = await this.prisma.sceneIndex.findUnique({
          where: { stashId },
        });
        if (row) await this.project(row, source);
      });
    this.workers.add(job);
    void job.catch(() =>
      this.logger.warn('Diagnostic attempt requires review.'),
    );
    return created;
  }

  async closeInterrupted(stashId: string, id: string) {
    const attempt = await this.prisma.requestSearchAttempt.findUnique({
      where: { id },
    });
    if (
      !attempt ||
      attempt.stashId !== stashId ||
      !['UNCERTAIN', 'COMPLETED'].includes(attempt.state)
    )
      throw new ConflictException('This diagnostic is not awaiting review.');
    if (this.workers.size)
      throw new ConflictException('A diagnostic worker is still active.');
    if (attempt.state === 'COMPLETED') {
      const action = await this.prisma.requestAction.findUnique({
        where: { id },
      });
      if (action?.kind !== 'DIAGNOSTIC_SEARCH')
        throw new ConflictException('This action is not a diagnostic.');
      await this.operations.finish(stashId, id, 'SUCCEEDED', {
        outcome: 'DIAGNOSTIC_COMPLETE',
      });
      return { outcome: 'DIAGNOSTIC_COMPLETE' };
    }
    const config = await this.config();
    if (attempt.source !== this.source(config))
      throw new ConflictException(
        'Restore the original integration before checking this interrupted search.',
      );
    const commands = await this.whisparr.getSearchCommands({
      baseUrl: config.baseUrl!,
      apiKey: config.apiKey,
    });
    if (
      commands.some(
        (c) =>
          c.movieIds.includes(attempt.movieId) &&
          active.includes(c.status.toLowerCase()),
      )
    )
      throw new ConflictException('Whisparr still reports a running search.');
    if (Date.now() - attempt.createdAt.getTime() < 180_000)
      throw new ConflictException(
        'Wait at least three minutes before closing an interrupted diagnostic.',
      );
    await this.prisma.$transaction(async (tx) => {
      const action = await tx.requestAction.findUnique({ where: { id } });
      if (action && action.kind !== 'DIAGNOSTIC_SEARCH')
        throw new ConflictException('Action identity changed.');
      await tx.requestSearchAttempt.updateMany({
        where: { id, state: 'UNCERTAIN' },
        data: { state: 'CLOSED', finishedAt: new Date() },
      });
      if (action) {
        await tx.requestAction.update({
          where: { id },
          data: {
            state: 'SUCCEEDED',
            result: { outcome: 'DIAGNOSTIC_CLOSED_WITHOUT_RESULTS' },
          },
        });
        await tx.request.updateMany({
          where: { stashId, activeActionId: id },
          data: { activeActionId: null },
        });
      }
    });
    return { outcome: 'CLOSED_WITHOUT_RESULTS' };
  }

  async settings() {
    return (
      (await this.prisma.hydraSearchSettings.findUnique({
        where: { id: 'default' },
      })) ?? { browserUrl: '', studio: true, performers: true, title: false }
    );
  }
  async saveSettings(dto: HydraSettingsDto) {
    const browserUrl = dto.browserUrl.trim()
      ? normalizeBrowserUrl(dto.browserUrl)
      : '';
    if (browserUrl === null)
      throw new BadRequestException(
        'Use an HTTP(S) browser URL without credentials, query parameters or fragments.',
      );
    return this.prisma.hydraSearchSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', ...dto, browserUrl },
      update: { ...dto, browserUrl },
    });
  }
  async terms(stashId: string) {
    const provider = await this.catalog.getConfiguredCatalogProvider();
    const scene = await this.stashdb.getSceneById(stashId, provider);
    const performers = scene.performers.map((p) => p.name);
    await this.prisma.requestDiagnosticObservation.updateMany({
      where: { stashId },
      data: {
        performers,
        performerText: performers.join(' '),
        metadataAt: new Date(),
        metadataSource: evidenceId(provider.providerKey, provider.baseUrl),
      },
    });
    return { studio: scene.studioName ?? '', performers, title: scene.title };
  }

  private async hydratePerformers() {
    const provider = await this.catalog.getConfiguredCatalogProvider();
    const metadataSource = evidenceId(provider.providerKey, provider.baseUrl);
    const rows = await this.prisma.requestDiagnosticObservation.findMany({
      where: {
        scene: { computedLifecycle: { in: [...stages] } },
        OR: [
          { metadataAt: null },
          { metadataAt: { lt: new Date(Date.now() - 86400_000) } },
          { metadataSource: { not: metadataSource } },
        ],
      },
      orderBy: [
        { metadataAt: { sort: 'asc', nulls: 'first' } },
        { stashId: 'asc' },
      ],
      take: 10,
    });
    if (!rows.length) return;
    const metadata = await this.stashdb.getSceneMetadataByIds(
      rows.map((r) => r.stashId),
      provider,
    );
    for (const scene of metadata) {
      if (!scene.performerNames) continue;
      await this.prisma.requestDiagnosticObservation.updateMany({
        where: { stashId: scene.id },
        data: {
          performers: scene.performerNames,
          performerText: scene.performerNames.join(' '),
          metadataAt: new Date(),
          metadataSource,
        },
      });
    }
  }

  async table(query: DiagnosticTableQuery) {
    const evidence = await this.indexing.getAcquisitionEvidence();
    return this.prisma.$transaction(
      async (tx) => {
        const page = query.page ?? 1,
          perPage = query.perPage ?? 24;
        const sourceUnavailable =
          reconcileAcquisition(
            {
              computedLifecycle: 'REQUESTED',
              requestStatus: 'REQUESTED',
              requestUpdatedAt: null,
              whisparrMovieId: 1,
              whisparrHasFile: false,
              whisparrQueueStatus: null,
              whisparrErrorMessage: null,
            },
            evidence,
          ).condition === 'STATUS_UNAVAILABLE';
        const q = query.q?.trim();
        const base: Prisma.SceneIndexWhereInput = {
          computedLifecycle: { in: [...stages] },
          ...(q
            ? {
                OR: [
                  { title: { contains: q, mode: 'insensitive' } },
                  { studioName: { contains: q, mode: 'insensitive' } },
                  {
                    diagnostics: {
                      performerText: { contains: q, mode: 'insensitive' },
                    },
                  },
                ],
              }
            : {}),
        };
        const scope: Prisma.SceneIndexWhereInput = {
          ...base,
          ...(query.lifecycle && query.lifecycle !== 'ANY'
            ? { computedLifecycle: query.lifecycle }
            : {}),
        };
        const staleAt = new Date(Date.now() - 120_000);
        const staleWhere: Prisma.SceneIndexWhereInput = {
          diagnostics: { checkedAt: { lt: staleAt } },
        };
        const attentionWhere: Prisma.SceneIndexWhereInput = {
          OR: [
            { computedLifecycle: 'FAILED' },
            { diagnostics: { priority: 0 } },
            staleWhere,
          ],
        };
        const blockerWhere: Prisma.SceneIndexWhereInput[] = !query.blocker
          ? []
          : sourceUnavailable
            ? ['STATUS_UNAVAILABLE', 'NEEDS_ATTENTION'].includes(query.blocker)
              ? []
              : [{ stashId: { in: [] } }]
            : [
                query.blocker === 'NEEDS_ATTENTION'
                  ? attentionWhere
                  : query.blocker === 'STATUS_UNAVAILABLE'
                    ? {
                        OR: [
                          staleWhere,
                          { diagnostics: { code: 'STATUS_UNAVAILABLE' } },
                        ],
                      }
                    : {
                        AND: [
                          { NOT: staleWhere },
                          query.blocker === 'UNKNOWN'
                            ? {
                                OR: [
                                  { diagnostics: { is: null } },
                                  { diagnostics: { code: 'UNKNOWN' } },
                                ],
                              }
                            : { diagnostics: { code: query.blocker } },
                        ],
                      },
              ];
        const where: Prisma.SceneIndexWhereInput = {
          AND: [scope, ...blockerWhere],
        };
        const orderBy: Prisma.SceneIndexOrderByWithRelationInput[] =
          query.sort === 'ACTIVITY'
            ? [{ diagnostics: { activityAt: 'desc' } }, { stashId: 'asc' }]
            : query.sort === 'OLDEST'
              ? [
                  {
                    diagnostics: {
                      requestedAt: { sort: 'asc', nulls: 'last' },
                    },
                  },
                  { createdAt: 'asc' },
                  { stashId: 'asc' },
                ]
              : [
                  { diagnostics: { priority: 'asc' } },
                  {
                    diagnostics: {
                      requestedAt: { sort: 'asc', nulls: 'last' },
                    },
                  },
                  { createdAt: 'asc' },
                  { stashId: 'asc' },
                ];
        const [rows, total, counts, blockers, settings, provider] =
          await Promise.all([
            tx.sceneIndex.findMany({
              where,
              include: { diagnostics: true },
              orderBy,
              skip: (page - 1) * perPage,
              take: perPage,
            }),
            tx.sceneIndex.count({ where }),
            tx.sceneIndex.groupBy({
              by: ['computedLifecycle'],
              where: base,
              _count: true,
            }),
            tx.requestDiagnosticObservation.groupBy({
              by: ['code'],
              where: { scene: scope, checkedAt: { gte: staleAt } },
              _count: true,
            }),
            this.settings(),
            this.catalog.getConfiguredCatalogProviderOrNull(),
          ]);
        const countsByLifecycle = Object.fromEntries(
          stages.map((s) => [
            s,
            counts.find((c) => c.computedLifecycle === s)?._count ?? 0,
          ]),
        );
        const trackedCount = Object.values(countsByLifecycle).reduce(
          (a, b) => a + b,
          0,
        );
        const [
          unknown,
          scopedTotal,
          rowVersion,
          observationVersion,
          staleCount,
          attentionCount,
        ] = await Promise.all([
          tx.sceneIndex.count({
            where: { ...scope, diagnostics: { is: null } },
          }),
          tx.sceneIndex.count({ where: scope }),
          tx.sceneIndex.aggregate({
            where: scope,
            _max: { updatedAt: true },
          }),
          tx.requestDiagnosticObservation.aggregate({
            where: { scene: scope },
            _max: { checkedAt: true, metadataAt: true },
          }),
          tx.sceneIndex.count({ where: { AND: [scope, staleWhere] } }),
          tx.sceneIndex.count({ where: { AND: [scope, attentionWhere] } }),
        ]);
        return {
          total,
          page,
          perPage,
          hasMore: page * perPage < total,
          countsByLifecycle,
          trackedCount,
          selectionVersion: evidenceId(
            rowVersion,
            observationVersion,
            scopedTotal,
          ),
          blockerCounts: sourceUnavailable
            ? { STATUS_UNAVAILABLE: scopedTotal, NEEDS_ATTENTION: scopedTotal }
            : {
                ...Object.fromEntries(blockers.map((b) => [b.code, b._count])),
                STATUS_UNAVAILABLE:
                  staleCount +
                  (blockers.find((b) => b.code === 'STATUS_UNAVAILABLE')
                    ?._count ?? 0),
                NEEDS_ATTENTION: attentionCount,
                UNKNOWN:
                  unknown +
                  (blockers.find((b) => b.code === 'UNKNOWN')?._count ?? 0),
              },
          items: rows.map((row) => {
            const reconciliation = reconcileAcquisition(row, evidence);
            const overriding = shortStatus(reconciliation.condition);
            let diagnostics =
              row.diagnostics &&
              reconciliation.condition === 'WAITING_FOR_RELEASE'
                ? row.diagnostics
                : {
                    ...row.diagnostics,
                    ...overriding,
                    detail: reconciliation.message,
                  };
            if (
              !sourceUnavailable &&
              row.diagnostics &&
              row.diagnostics.checkedAt < staleAt
            )
              diagnostics = {
                ...diagnostics,
                code: 'STATUS_UNAVAILABLE',
                label:
                  reconciliation.condition === 'WAITING_FOR_RELEASE'
                    ? 'Diagnostics need refresh'
                    : overriding.label + ' · history stale',
              };
            return {
              id: row.stashId,
              title: row.title || row.stashId,
              studio: row.studioName,
              studioId: row.studioId,
              performers: row.diagnostics?.performers ?? [],
              status: this.indexing.toSceneStatus(row),
              reconciliation,
              diagnostics,
              requestedAt: row.diagnostics?.requestedAt ?? row.createdAt,
              activityAt: row.diagnostics?.activityAt ?? row.requestUpdatedAt,
              checkedAt: reconciliation.checkedAt,
              source: provider?.providerKey ?? 'STASHDB',
              type: 'SCENE',
              imageUrl: null,
            };
          }),
          hydraConfigured: !!settings.browserUrl,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
