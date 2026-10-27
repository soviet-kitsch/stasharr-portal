import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import {
  appendBrowserPath,
  integrationBrowserBaseUrl,
} from '../integrations/browser-url.util';
import { IndexingService } from '../indexing/indexing.service';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogProviderService } from '../providers/catalog/catalog-provider.service';
import { resolveCatalogProviderKey } from '../providers/catalog/catalog-provider.util';
import { fetchWithTimeout } from '../providers/fetch-with-timeout';
import { WhisparrAdapter } from '../providers/whisparr/whisparr.adapter';
import { StashAdapter } from '../providers/stash/stash.adapter';

type Config = {
  baseUrl: string;
  apiKey?: string | null;
  browserUrl?: string | null;
};
type SourceState = 'CHECKED' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
interface ListedScene {
  id: string;
  title: string | null;
  organized: boolean;
  files: { path: string; size: number | null }[];
  refs: { endpoint: string; stashId: string }[];
}
export interface ImportMatchReview {
  sceneId: string;
  checkedAt: string;
  snapshotAt: string | null;
  whisparr: {
    state: SourceState;
    hasFile: boolean | null;
    filePath: string | null;
    fileSize: number | null;
    viewUrl: string | null;
  };
  stash: {
    state: SourceState;
    viewUrl: string | null;
    candidatesTruncated: boolean;
  };
  condition:
    | 'MATCH_FOUND'
    | 'POSSIBLE_FILE_MATCH'
    | 'CATALOG_CONFLICT'
    | 'NO_FILE_CANDIDATE'
    | 'NOT_IMPORTED'
    | 'UNVERIFIED';
  summary: string;
  candidates: {
    id: string;
    title: string;
    viewUrl: string | null;
    evidence:
      | 'CATALOG_ID'
      | 'SOURCE_IDENTITY'
      | 'PATH_AND_SIZE'
      | 'FILENAME_AND_SIZE'
      | 'PATH_ONLY'
      | 'FILENAME_ONLY';
    evidenceLabel: string;
    organized: boolean;
    catalogIds: string[];
    files: { path: string; size: number | null }[];
  }[];
  portalStatus?: string;
  reconciliationMessage?: string;
  nextSteps: string[];
  limitations: string[];
}

@Injectable()
export class ImportMatchReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly catalogs: CatalogProviderService,
    private readonly whisparr: WhisparrAdapter,
    private readonly indexing: IndexingService,
    @Optional() private readonly stashAdapter?: StashAdapter,
  ) {}

  async review(id: string): Promise<ImportMatchReview> {
    const sceneId = id.trim();
    if (!sceneId || sceneId.length > 100)
      throw new BadRequestException('A valid scene id is required.');
    const row = await this.prisma.sceneIndex.findUnique({
      where: { stashId: sceneId },
    });
    if (!row)
      throw new NotFoundException(
        'This scene has no acquisition evidence yet. Refresh Portal status first.',
      );
    const [whis, stash, provider] = await Promise.all([
      this.config(IntegrationType.WHISPARR),
      this.config(IntegrationType.STASH),
      this.catalogs.getConfiguredCatalogProvider().catch(() => null),
    ]);
    const result: ImportMatchReview = {
      sceneId,
      checkedAt: new Date().toISOString(),
      snapshotAt: row.stashLastSyncedAt?.toISOString() ?? null,
      whisparr: {
        state: whis ? 'UNAVAILABLE' : 'NOT_CONFIGURED',
        hasFile: null,
        filePath: null,
        fileSize: null,
        viewUrl: null,
      },
      stash: {
        state: stash ? 'UNAVAILABLE' : 'NOT_CONFIGURED',
        viewUrl: null,
        candidatesTruncated: false,
      },
      condition: 'UNVERIFIED',
      summary: 'The current match could not be verified.',
      candidates: [],
      nextSteps: [],
      limitations: [
        'This review reads provider records only. It does not inspect filesystem inodes or verify that a listed file is currently readable.',
        'Matching names, paths or sizes are review hints; they do not prove that two files or catalog versions are identical.',
      ],
    };
    if (whis) {
      try {
        // Look up the catalog id afresh; an old numeric movie id may have been reused.
        const movie = await this.whisparr.findMovieByStashId(sceneId, whis);
        result.whisparr = {
          state: 'CHECKED',
          hasFile: movie?.hasFile ?? false,
          filePath: movie?.filePath ?? null,
          fileSize: movie?.fileSize ?? null,
          viewUrl:
            movie && integrationBrowserBaseUrl(whis)
              ? this.whisparr.buildSceneViewUrl(
                  integrationBrowserBaseUrl(whis)!,
                  movie.movieId,
                )
              : null,
        };
      } catch {
        /* Leave source explicitly unavailable; never infer absence from an error. */
      }
    }
    let catalogScenes: ListedScene[] = [];
    let fileScenes: ListedScene[] = [];
    if (stash && provider) {
      const queries: Promise<{ total: number; scenes: ListedScene[] }>[] = [
        this.list(stash, {
          stash_id_endpoint: { stash_id: sceneId, modifier: 'EQUALS' },
        }),
      ];
      const basename = this.basename(result.whisparr.filePath);
      if (basename && basename.length >= 6 && basename.length <= 512) {
        queries.push(
          this.list(stash, { path: { value: basename, modifier: 'INCLUDES' } }),
        );
      }
      const responses = await Promise.allSettled(queries);
      if (responses[0].status === 'fulfilled') {
        catalogScenes = responses[0].value.scenes;
        result.stash.state = 'CHECKED';
      }
      if (responses[1]?.status === 'fulfilled')
        fileScenes = responses[1].value.scenes;
      if (responses.some((response) => response.status === 'rejected')) {
        result.stash.state = 'UNAVAILABLE';
        result.limitations.push(
          'At least one Stash lookup failed. Candidate coverage is incomplete; an empty list does not confirm absence.',
        );
      }
      result.stash.candidatesTruncated = responses.some(
        (response) =>
          response.status === 'fulfilled' &&
          response.value.total > response.value.scenes.length,
      );
      const candidates = new Map(
        [...catalogScenes, ...fileScenes].map((scene) => [scene.id, scene]),
      );
      for (const scene of candidates.values()) {
        const catalogIds = scene.refs
          .filter(
            (ref) =>
              resolveCatalogProviderKey(ref.endpoint) === provider.providerKey,
          )
          .map((ref) => ref.stashId);
        const exactCatalog = catalogIds.includes(sceneId);
        const path = result.whisparr.filePath;
        const name = this.basename(path);
        const matchingFiles = scene.files.filter(
          (file) =>
            path && (file.path === path || this.basename(file.path) === name),
        );
        // Discard broad path substring matches; never suggest a scene merely because a directory name matched.
        if (!exactCatalog && !matchingFiles.length) continue;
        const exactPath = matchingFiles.some((file) => file.path === path);
        const sizeMatch = matchingFiles.some(
          (file) =>
            file.size !== null &&
            file.size === result.whisparr.fileSize &&
            (!exactPath || file.path === path),
        );
        const evidence = exactCatalog
          ? 'CATALOG_ID'
          : exactPath
            ? sizeMatch
              ? 'PATH_AND_SIZE'
              : 'PATH_ONLY'
            : sizeMatch
              ? 'FILENAME_AND_SIZE'
              : 'FILENAME_ONLY';
        result.candidates.push({
          id: scene.id,
          title: scene.title ?? `Stash scene ${scene.id}`,
          viewUrl: appendBrowserPath(
            integrationBrowserBaseUrl(stash) ?? '',
            `scenes/${encodeURIComponent(scene.id)}`,
          ),
          evidence,
          evidenceLabel: {
            CATALOG_ID: 'Exact catalog link',
            PATH_AND_SIZE: 'Same reported path and size — verify the version',
            PATH_ONLY: 'Same reported path — file identity unverified',
            FILENAME_AND_SIZE:
              'Same filename and size — file identity unverified',
            FILENAME_ONLY: 'Same filename only — unconfirmed',
          }[evidence],
          organized: scene.organized,
          catalogIds,
          files: scene.files,
        });
      }
      result.candidates.sort(
        (a, b) =>
          Number(b.evidence === 'CATALOG_ID') -
          Number(a.evidence === 'CATALOG_ID'),
      );
    }
    if (
      stash &&
      provider &&
      this.stashAdapter &&
      result.stash.state === 'CHECKED' &&
      !result.candidates.some(
        (candidate) =>
          candidate.evidence === 'CATALOG_ID' && candidate.files.length,
      )
    ) {
      try {
        const copies = await this.stashAdapter.findScenesByStashId(
          sceneId,
          stash,
          { providerKey: provider.providerKey },
        );
        for (const copy of copies) {
          if (copy.evidence !== 'SOURCE_IDENTITY' || !copy.sourceIdentity)
            continue;
          const identity = copy.sourceIdentity;
          const candidate = result.candidates.find(
            (candidate) => candidate.id === copy.id,
          );
          const verified = {
            id: copy.id,
            title: identity.title ?? `Stash scene ${copy.id}`,
            viewUrl: copy.viewUrl,
            evidence: 'SOURCE_IDENTITY' as const,
            evidenceLabel:
              'Same official scene URL, catalog studio and file duration — alternate catalog entry',
            organized: candidate?.organized ?? false,
            catalogIds: identity.catalogIds,
            files: identity.files,
          };
          if (candidate) Object.assign(candidate, verified);
          else result.candidates.push(verified);
        }
      } catch {
        result.stash.state = 'UNAVAILABLE';
        result.limitations.push(
          'Source-identity verification was unavailable. No alternate catalog association was assumed.',
        );
      }
    }

    // Never send a scene-specific action to the unfiltered Stash overview.
    // Multiple candidates retain their own links; none is chosen automatically.
    const linkedCandidates = result.candidates.filter(
      (candidate) =>
        candidate.files.length > 0 &&
        ['CATALOG_ID', 'SOURCE_IDENTITY'].includes(candidate.evidence),
    );
    const targets = linkedCandidates.length
      ? linkedCandidates
      : result.candidates.filter((candidate) => candidate.files.length > 0);
    if (targets.length === 1) result.stash.viewUrl = targets[0].viewUrl;
    const exact = result.candidates.some(
      (candidate) =>
        ['CATALOG_ID', 'SOURCE_IDENTITY'].includes(candidate.evidence) &&
        candidate.files.length,
    );
    if (exact) {
      result.condition = 'MATCH_FOUND';
      const sourceMatch = result.candidates.some(
        (candidate) => candidate.evidence === 'SOURCE_IDENTITY',
      );
      result.summary = sourceMatch
        ? 'Stash has the same official scene URL, catalog studio and matching file duration under another catalog ID. Refresh this scene to reconcile Portal; catalog links remain unchanged.'
        : 'Stash now lists this catalog link with a file. Refresh Portal status to reconcile the library.';
      result.nextSteps = [
        'Open the matching Stash scene and confirm that its file can be played.',
        'Use Refresh this scene to reconcile Portal without downloading again.',
      ];
    } else if (
      result.whisparr.state !== 'CHECKED' ||
      result.stash.state !== 'CHECKED'
    ) {
      result.summary =
        'A required live lookup is unavailable or incomplete. A missing file or match has not been confirmed.';
      result.nextSteps = [
        'Check the affected integration and its API connection, then re-check this match.',
        'Use the last snapshot time as historical context, not proof of current absence.',
      ];
    } else if (!result.whisparr.hasFile) {
      result.condition = 'NOT_IMPORTED';
      result.summary =
        'Whisparr does not currently report an imported file for this catalog scene.';
      result.nextSteps = [
        'Open Whisparr and inspect the request, download and import queue before trying another acquisition.',
      ];
    } else if (
      result.candidates.some(
        (candidate) =>
          candidate.catalogIds.length &&
          !candidate.catalogIds.includes(sceneId),
      )
    ) {
      result.condition = 'CATALOG_CONFLICT';
      result.summary =
        'A possible Stash file is linked to a different catalog scene. Verify whether Whisparr or Stash has the incorrect association before changing either.';
      result.nextSteps = [
        'Open the candidate Stash scene and the Whisparr entry. Compare the actual video, performer, studio, duration, date and scene version with the requested scene.',
        'If Whisparr has the wrong file: correct its scene assignment using manual import, preserving the media file. Then acquire the originally requested scene only if it is still missing.',
        'If the file is correct but Stash has the wrong catalog link: use Identify on that Stash scene to review and save the intended link. Preserve legitimate alternate-version links.',
        'After correcting the association, use Refresh this scene here to update Portal. Re-request alone cannot repair an incorrect match.',
      ];
    } else if (result.candidates.length) {
      result.condition = 'POSSIBLE_FILE_MATCH';
      result.summary =
        'Stash lists possible file candidates, but the requested catalog link is not confirmed with a file.';
      result.nextSteps = [
        'Open each candidate in Stash and compare the file, duration, studio, release date and scene version.',
        'Use Stash’s Identify tool to review metadata. Save the intended catalog association only after confirming it; keep legitimate alternate-version links.',
        'After confirming and saving the catalog link in Stash, use Refresh this scene. A new download is not needed solely to repair a catalog link.',
      ];
    } else {
      result.condition = 'NO_FILE_CANDIDATE';
      result.summary =
        'Whisparr reports an imported file. These Stash lookups did not confirm its catalog link or find a file candidate.';
      result.nextSteps = [
        'Use the reported Whisparr file path to locate the file. Check that its completed folder is included in Stash’s library paths.',
        'In Stash, scan the completed folder if needed, search for the filename among unorganized scenes, then use Identify to review the catalog match.',
        'If container paths differ, compare the mount mappings. This review does not guess path translations or declare the file missing.',
        'After scanning or identification completes, refresh Portal status.',
      ];
    }
    if (result.stash.candidatesTruncated)
      result.limitations.push(
        'Only the first 20 records from each lookup were inspected. Open Stash to review the remaining candidates.',
      );
    return result;
  }

  async reconcile(sceneId: string): Promise<ImportMatchReview> {
    const review = await this.review(sceneId);
    if (review.stash.state !== 'CHECKED' || review.whisparr.state !== 'CHECKED')
      throw new BadGatewayException(
        'The integrations could not both be verified. Restore their connections before refreshing this scene.',
      );
    await this.indexing.requestImmediateRefresh(
      [review.sceneId],
      'import-recovery',
    );
    const row = await this.prisma.sceneIndex.findUnique({
      where: { stashId: review.sceneId },
    });
    review.portalStatus = row?.computedLifecycle;
    review.reconciliationMessage =
      row?.computedLifecycle === 'AVAILABLE'
        ? 'Portal now shows this scene as available in Stash.'
        : 'Portal status was rechecked. This scene still needs the import or catalog-link correction described below; no new download was started.';
    return review;
  }

  private async config(type: IntegrationType): Promise<Config | null> {
    try {
      const value = await this.integrations.findOne(type);
      return value.enabled &&
        value.status === IntegrationStatus.CONFIGURED &&
        value.baseUrl
        ? {
            baseUrl: value.baseUrl,
            apiKey: value.apiKey,
            browserUrl: value.browserUrl,
          }
        : null;
    } catch {
      return null;
    }
  }
  private basename(value: string | null): string | null {
    return value?.split(/[\\/]/).pop() || null;
  }
  private async list(
    config: Config,
    sceneFilter: unknown,
  ): Promise<{ total: number; scenes: ListedScene[] }> {
    const endpoint = new URL(config.baseUrl);
    endpoint.pathname =
      endpoint.pathname.replace(/\/+$/, '').replace(/\/graphql$/, '') +
      '/graphql';
    endpoint.search = '';
    endpoint.hash = '';
    const response = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { ApiKey: config.apiKey } : {}),
        },
        body: JSON.stringify({
          query: `query ImportMatchReview($sceneFilter: SceneFilterType) {
      findScenes(scene_filter: $sceneFilter, filter: { page: 1, per_page: 20, sort: "id", direction: ASC }) {
        count scenes { id title organized files { path size } stash_ids { endpoint stash_id } }
      }
    }`,
          variables: { sceneFilter },
        }),
      },
      12_000,
    );
    if (!response.ok)
      throw new BadGatewayException('Stash lookup is unavailable.');
    const json = (await response.json()) as {
      errors?: unknown[];
      data?: { findScenes?: { count?: unknown; scenes?: unknown } };
    };
    const data = json.data?.findScenes;
    if (
      json.errors?.length ||
      !data ||
      !Number.isInteger(data.count) ||
      (data.count as number) < 0 ||
      !Array.isArray(data.scenes) ||
      data.scenes.length !== Math.min(data.count as number, 20)
    )
      throw new BadGatewayException('Stash lookup is incomplete.');
    const scenes = data.scenes.map((raw: any): ListedScene => {
      if (
        !raw ||
        typeof raw.id !== 'string' ||
        !Array.isArray(raw.files) ||
        !Array.isArray(raw.stash_ids)
      )
        throw new BadGatewayException('Stash records are incomplete.');
      return {
        id: raw.id,
        title: typeof raw.title === 'string' ? raw.title : null,
        organized: raw.organized === true,
        files: raw.files.map((file: any) => {
          if (typeof file?.path !== 'string' || !file.path)
            throw new BadGatewayException('Stash file record is incomplete.');
          const size =
            typeof file.size === 'number' || typeof file.size === 'string'
              ? Number(file.size)
              : NaN;
          return {
            path: file.path,
            size: Number.isSafeInteger(size) && size > 0 ? size : null,
          };
        }),
        refs: raw.stash_ids.map((ref: any) => {
          if (
            typeof ref?.endpoint !== 'string' ||
            typeof ref.stash_id !== 'string'
          )
            throw new BadGatewayException(
              'Stash catalog reference is incomplete.',
            );
          return { endpoint: ref.endpoint, stashId: ref.stash_id };
        }),
      };
    });
    if (new Set(scenes.map((scene) => scene.id)).size !== scenes.length)
      throw new BadGatewayException('Stash lookup contains duplicate records.');
    return { total: data.count as number, scenes };
  }
}
