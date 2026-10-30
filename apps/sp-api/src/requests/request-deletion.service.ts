import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { posix, win32 } from 'node:path';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { integrationBrowserBaseUrl } from '../integrations/browser-url.util';
import { CatalogProviderService } from '../providers/catalog/catalog-provider.service';
import { WhisparrAdapter } from '../providers/whisparr/whisparr.adapter';
import {
  DeletionFile,
  WhisparrSceneDeletionAdapter,
} from '../providers/whisparr/whisparr-scene-deletion.adapter';
import { RequestOperationsService } from './request-operations.service';
import { IndexingService } from '../indexing/indexing.service';
import { DeleteWhisparrRequestDto } from './dto/delete-whisparr-request.dto';

interface Snapshot {
  movieId: number;
  stashId: string;
  title: string;
  folder: string;
  rootFolder: string;
  hasFile: boolean;
  added: string;
  files: DeletionFile[];
}
interface Approval {
  v: 1;
  stashId: string;
  expiresAt: number;
  nonce: string;
  connectionHash: string;
  catalogHash: string;
  snapshot: Snapshot;
}
interface Dispatch {
  operation: string;
  connectionHash: string;
  snapshot: Snapshot;
  nativeAccepted: boolean;
}
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function canonicalDeletionPath(path: string): string {
  if (
    typeof path !== 'string' ||
    !path ||
    path.length > 4096 ||
    /[\x00-\x1f]/.test(path) ||
    path.split(/[\\/]/).includes('..')
  )
    throw new ConflictException(
      'Whisparr supplied an unsafe folder or file path.',
    );
  const windows = /^[a-z]:[\\/]/i.test(path) || path.startsWith('\\\\');
  if (windows) {
    if (!win32.isAbsolute(path))
      throw new ConflictException('Whisparr path is not absolute.');
    return win32
      .normalize(path)
      .replace(/\\/g, '/')
      .replace(/\/+$/, '')
      .toLowerCase();
  }
  if (!posix.isAbsolute(path))
    throw new ConflictException('Whisparr path is not absolute.');
  return posix.normalize(path).replace(/\/+$/, '') || '/';
}
const child = (parent: string, path: string) =>
  path !== parent && path.startsWith(parent + '/');

@Injectable()
export class RequestDeletionService {
  // A restart invalidates outstanding previews. Executed-action recovery uses persisted details.
  private readonly signingKey = randomBytes(32);
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly catalog: CatalogProviderService,
    private readonly native: WhisparrSceneDeletionAdapter,
    private readonly whis: WhisparrAdapter,
    private readonly operations: RequestOperationsService,
    private readonly indexing: IndexingService,
  ) {}
  private id(value: string) {
    const id = value.trim().toLowerCase();
    if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id))
      throw new BadRequestException('A valid catalog scene ID is required.');
    return id;
  }
  private async connection() {
    const config = await this.integrations.findOne('WHISPARR');
    if (!config.enabled || config.status !== 'CONFIGURED' || !config.baseUrl)
      throw new ConflictException(
        'Whisparr must be configured and enabled for file deletion.',
      );
    return {
      config: { baseUrl: config.baseUrl, apiKey: config.apiKey },
      browserBase: integrationBrowserBaseUrl(config) ?? config.baseUrl,
      connectionHash: hash([config.id, config.baseUrl, config.apiKey]),
    };
  }
  private async catalogIdentity() {
    const config = await this.catalog.getConfiguredCatalogProvider();
    if (config.providerKey !== 'STASHDB')
      throw new ConflictException(
        'Whisparr file deletion requires an exact StashDB scene mapping.',
      );
    return hash([config.providerKey, config.baseUrl]);
  }
  private async inspect(
    id: string,
    config: { baseUrl: string; apiKey?: string | null },
  ): Promise<Snapshot> {
    const [scenes, roots] = await Promise.all([
      this.native.scenes(config),
      this.native.roots(config),
    ]);
    const matches = scenes.filter((s) => s.stashId === id);
    if (matches.length !== 1)
      throw new ConflictException(
        matches.length
          ? 'Whisparr scene identity is ambiguous. Review it in Whisparr.'
          : 'No exact Whisparr scene was found. Portal-only deletion is still available.',
      );
    const scene = matches[0],
      folder = canonicalDeletionPath(scene.path);
    const root = roots
      .filter(
        (r) => r.accessible && child(canonicalDeletionPath(r.path), folder),
      )
      .sort((a, b) => b.path.length - a.path.length)[0];
    if (!root)
      throw new ConflictException(
        'The scene folder must be strictly inside an accessible Whisparr root folder.',
      );
    const rootPath = canonicalDeletionPath(root.path);
    if (rootPath === '/' || /^[a-z]:$/i.test(rootPath))
      throw new ConflictException(
        'The configured Whisparr root is too broad for this deletion.',
      );
    for (const other of scenes) {
      if (other.id === scene.id) continue;
      const path = canonicalDeletionPath(other.path);
      if (path === folder || child(folder, path) || child(path, folder))
        throw new ConflictException(
          'The scene folder overlaps another Whisparr scene. File deletion is blocked.',
        );
    }
    const files = await this.native.files(scene.id, config);
    if (
      scene.hasFile !== files.length > 0 ||
      files.some((f) => !child(folder, canonicalDeletionPath(f.path)))
    )
      throw new ConflictException(
        'Whisparr file evidence changed or includes files outside the scene folder. Refresh and review the match.',
      );
    await this.native.assertIdle(scene.id, config);
    return {
      movieId: scene.id,
      stashId: id,
      title: scene.title,
      folder: scene.path,
      rootFolder: root.path,
      hasFile: scene.hasFile,
      added: scene.added,
      files,
    };
  }
  async preview(stashId: string) {
    const id = this.id(stashId);
    const request = await this.prisma.request.findUnique({
      where: { stashId: id },
    });
    if (request?.activeActionId)
      throw new ConflictException(
        'Another action is active or needs an outcome check. Resolve it in Item History first.',
      );
    const [connection, catalogHash] = await Promise.all([
      this.connection(),
      this.catalogIdentity(),
    ]);
    const snapshot = await this.inspect(id, connection.config);
    const approval: Approval = {
      v: 1,
      stashId: id,
      expiresAt: Date.now() + 5 * 60_000,
      nonce: randomUUID(),
      connectionHash: connection.connectionHash,
      catalogHash,
      snapshot,
    };
    const body = Buffer.from(JSON.stringify(approval)).toString('base64url');
    const signature = createHmac('sha256', this.signingKey)
      .update(body)
      .digest('base64url');
    return {
      sceneId: id,
      whisparrSceneId: snapshot.movieId,
      title: snapshot.title,
      folder: snapshot.folder,
      rootFolder: snapshot.rootFolder,
      files: snapshot.files,
      expiresAt: new Date(approval.expiresAt).toISOString(),
      whisparrUrl: this.whis.buildSceneViewUrl(
        connection.browserBase,
        snapshot.movieId,
      ),
      previewToken: body + '.' + signature,
      fileDeletion: 'ENTIRE_SCENE_FOLDER_ASYNC',
      recovery:
        'Whisparr uses its configured recycle bin if available; deletion may be permanent. Portal cannot restore the files.',
    };
  }
  private approval(
    token: string,
    id: string,
  ): { approval: Approval; digest: string } {
    try {
      if (typeof token !== 'string' || token.length > 32768) throw new Error();
      const [body, signature, ...extra] = token.split('.');
      if (!body || !signature || extra.length) throw new Error();
      const expected = createHmac('sha256', this.signingKey)
        .update(body)
        .digest();
      const supplied = Buffer.from(signature, 'base64url');
      if (
        expected.length !== supplied.length ||
        !timingSafeEqual(expected, supplied)
      )
        throw new Error();
      const approval = JSON.parse(
        Buffer.from(body, 'base64url').toString(),
      ) as Approval;
      if (
        approval.v !== 1 ||
        approval.stashId !== id ||
        !Number.isSafeInteger(approval.expiresAt) ||
        !approval.snapshot
      )
        throw new Error();
      return { approval, digest: hash(body) };
    } catch {
      throw new BadRequestException(
        'The deletion preview is invalid or expired after a restart. Refresh the preview.',
      );
    }
  }
  async remove(stashId: string, dto: DeleteWhisparrRequestDto) {
    const id = this.id(stashId);
    if (dto.confirmDeleteFiles !== true)
      throw new BadRequestException(
        'Explicit confirmation of Whisparr file deletion is required.',
      );
    const { approval, digest } = this.approval(dto.previewToken, id);
    return this.operations.run(
      id,
      dto.operationKey,
      'DELETE_WHISPARR',
      { deleteFiles: true, previewDigest: digest },
      async (beforeDispatch) => {
        const current = await this.connection();
        const catalogHash = await this.catalogIdentity();
        if (
          Date.now() > approval.expiresAt ||
          current.connectionHash !== approval.connectionHash ||
          catalogHash !== approval.catalogHash
        )
          throw new ConflictException(
            'The deletion preview expired or its connected service changed. Refresh it.',
          );
        const snapshot = await this.inspect(id, current.config);
        if (
          hash(snapshot) !== hash(approval.snapshot) ||
          Date.now() > approval.expiresAt
        )
          throw new ConflictException(
            'The Whisparr scene, folder or files changed after preview. Review a fresh preview before deleting.',
          );
        const details: Dispatch = {
          operation: 'DELETE_WHISPARR_SCENE',
          connectionHash: current.connectionHash,
          snapshot,
          nativeAccepted: false,
        };
        await beforeDispatch(details as unknown as Prisma.InputJsonObject);
        await this.native.deleteSceneAndFiles(snapshot.movieId, current.config);
        details.nativeAccepted = true;
        const recorded = await this.prisma.requestAction.updateMany({
          where: { id: dto.operationKey, state: 'RUNNING' },
          data: { details: details as unknown as Prisma.InputJsonObject },
        });
        if (recorded.count !== 1)
          throw new ConflictException(
            'The deletion acknowledgment could not be recorded. Check its outcome.',
          );
        await this.assertRemoved(snapshot, current.config);
        return this.complete(id, snapshot, true);
      },
    );
  }
  private async assertRemoved(
    snapshot: Snapshot,
    config: { baseUrl: string; apiKey?: string | null },
  ) {
    const [scene, scenes] = await Promise.all([
      this.native.sceneById(snapshot.movieId, config),
      this.native.scenes(config),
    ]);
    if (
      scene ||
      scenes.some(
        (s) => s.id === snapshot.movieId || s.stashId === snapshot.stashId,
      )
    )
      throw new ConflictException(
        'Whisparr scene removal is not yet confirmed. No deletion will be sent again automatically.',
      );
  }
  private async complete(id: string, snapshot: Snapshot, accepted: boolean) {
    await this.prisma.request.update({
      where: { stashId: id },
      data: { dismissedAt: new Date(), revision: { increment: 1 } },
    });
    let projectionPending = false;
    try {
      await this.indexing.refreshRequestRow(id);
    } catch {
      projectionPending = true;
    }
    return {
      outcome: 'WHISPARR_SCENE_REMOVED',
      whisparrSceneId: snapshot.movieId,
      folder: snapshot.folder,
      files: snapshot.files,
      fileCleanup: accepted ? 'REQUESTED_NOT_VERIFIED' : 'OUTCOME_UNKNOWN',
      projectionPending,
      message: accepted
        ? `Whisparr scene ${snapshot.movieId} removed. File cleanup was requested for ${snapshot.folder}; filesystem deletion is not verified.`
        : `Whisparr scene ${snapshot.movieId} is absent. The previous file cleanup outcome is unknown for ${snapshot.folder}.`,
    };
  }
  async recoverIfNeeded(stashId: string) {
    const id = this.id(stashId);
    const request = await this.prisma.request.findUnique({
      where: { stashId: id },
    });
    if (!request?.activeActionId) return null;
    const action = await this.prisma.requestAction.findUnique({
      where: { id: request.activeActionId },
    });
    if (action?.kind !== 'DELETE_WHISPARR') return null;
    if (
      action.state === 'RUNNING' &&
      Date.now() - action.updatedAt.getTime() < 2 * 60_000
    )
      throw new ConflictException(
        'The deletion may still be running. Wait before checking its outcome.',
      );
    if (!action.dispatchedAt) {
      await this.operations.recoverUnsent(id, action.id);
      return {
        outcome: 'NOT_SENT',
        message:
          'The interrupted deletion was not sent. A fresh preview is required.',
      };
    }
    const details = action.details as unknown as Dispatch;
    const current = await this.connection();
    if (
      !details?.snapshot ||
      details.snapshot.stashId !== id ||
      details.connectionHash !== current.connectionHash
    )
      throw new ConflictException(
        'The Whisparr connection or deletion identity changed. Restore the original connection before checking this outcome.',
      );
    await this.assertRemoved(details.snapshot, current.config);
    const result = await this.complete(
      id,
      details.snapshot,
      details.nativeAccepted === true,
    );
    await this.operations.finish(id, action.id, 'SUCCEEDED', result);
    return result;
  }
}
