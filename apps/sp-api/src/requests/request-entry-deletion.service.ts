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
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { integrationBrowserBaseUrl } from '../integrations/browser-url.util';
import { CatalogProviderService } from '../providers/catalog/catalog-provider.service';
import { WhisparrAdapter } from '../providers/whisparr/whisparr.adapter';
import {
  DeletionScene,
  WhisparrSceneDeletionAdapter,
} from '../providers/whisparr/whisparr-scene-deletion.adapter';
import { IndexingService } from '../indexing/indexing.service';
import { RequestOperationsService } from './request-operations.service';
import { DeleteWhisparrEntryDto } from './dto/delete-whisparr-entry.dto';

interface Approval {
  operation: 'DELETE_WHISPARR_ENTRY';
  stashId: string;
  expiresAt: number;
  nonce: string;
  connectionHash: string;
  catalogHash: string;
  scene: DeletionScene | null;
}
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

@Injectable()
export class RequestEntryDeletionService {
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
    const [config, catalog] = await Promise.all([
      this.integrations.findOne('WHISPARR'),
      this.catalog.getConfiguredCatalogProvider(),
    ]);
    if (!config.enabled || config.status !== 'CONFIGURED' || !config.baseUrl)
      throw new ConflictException(
        'Whisparr could not be checked. No request or entry was removed.',
      );
    if (catalog.providerKey !== 'STASHDB')
      throw new ConflictException(
        'Whisparr entry deletion requires an exact StashDB scene mapping.',
      );
    return {
      config: { baseUrl: config.baseUrl, apiKey: config.apiKey },
      browserBase: integrationBrowserBaseUrl(config) ?? config.baseUrl,
      connectionHash: hash([config.id, config.baseUrl, config.apiKey]),
      catalogHash: hash([catalog.providerKey, catalog.baseUrl]),
    };
  }
  private async inspect(
    id: string,
    config: { baseUrl: string; apiKey?: string | null },
  ) {
    const matches = (await this.native.scenes(config)).filter(
      (s) => s.stashId === id,
    );
    if (matches.length > 1)
      throw new ConflictException(
        'Whisparr scene identity is ambiguous. Review it in Whisparr.',
      );
    const scene = matches[0] ?? null;
    if (scene) await this.native.assertIdle(scene.id, config);
    return scene;
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
    const connection = await this.connection();
    const scene = await this.inspect(id, connection.config);
    const approval: Approval = {
      operation: 'DELETE_WHISPARR_ENTRY',
      stashId: id,
      expiresAt: Date.now() + 5 * 60_000,
      nonce: randomUUID(),
      connectionHash: connection.connectionHash,
      catalogHash: connection.catalogHash,
      scene,
    };
    const body = Buffer.from(JSON.stringify(approval)).toString('base64url');
    return {
      sceneId: id,
      whisparrSceneId: scene?.id ?? null,
      title: scene?.title ?? null,
      whisparrUrl: scene
        ? this.whis.buildSceneViewUrl(connection.browserBase, scene.id)
        : null,
      filesKept: true,
      expiresAt: new Date(approval.expiresAt).toISOString(),
      previewToken:
        body +
        '.' +
        createHmac('sha256', this.signingKey).update(body).digest('base64url'),
    };
  }
  private approval(token: string, id: string) {
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
        approval.operation !== 'DELETE_WHISPARR_ENTRY' ||
        approval.stashId !== id ||
        !Number.isSafeInteger(approval.expiresAt) ||
        !(approval.scene === null || approval.scene?.stashId === id)
      )
        throw new Error();
      return { approval, digest: hash(body) };
    } catch {
      throw new BadRequestException(
        'The entry-deletion preview is invalid. Refresh the review.',
      );
    }
  }
  async remove(stashId: string, dto: DeleteWhisparrEntryDto) {
    const id = this.id(stashId);
    if (dto.confirmDeleteEntry !== true)
      throw new BadRequestException(
        'Explicit confirmation of Whisparr entry deletion is required.',
      );
    const { approval, digest } = this.approval(dto.previewToken, id);
    return this.operations.run(
      id,
      dto.operationKey,
      'DELETE_WHISPARR_ENTRY',
      { deleteFiles: false, previewDigest: digest },
      async (dispatch) => {
        const current = await this.connection();
        if (
          Date.now() > approval.expiresAt ||
          current.connectionHash !== approval.connectionHash ||
          current.catalogHash !== approval.catalogHash
        )
          throw new ConflictException(
            'The preview expired or its connected service changed. Refresh the review.',
          );
        const scene = await this.inspect(id, current.config);
        if (
          hash(scene) !== hash(approval.scene) ||
          Date.now() > approval.expiresAt
        )
          throw new ConflictException(
            'The Whisparr entry changed after review. Review it again before deleting.',
          );
        if (scene) {
          await dispatch({
            operation: 'DELETE_WHISPARR_ENTRY',
            scene,
            connectionHash: current.connectionHash,
            catalogHash: current.catalogHash,
          } as unknown as Prisma.InputJsonObject);
          await this.native.deleteSceneEntry(scene.id, current.config);
          await this.assertRemoved(id, scene.id, current.config);
        }
        return this.complete(id, scene?.id ?? null);
      },
    );
  }
  private async assertRemoved(
    id: string,
    movieId: number,
    config: { baseUrl: string; apiKey?: string | null },
  ) {
    const [scene, scenes] = await Promise.all([
      this.native.sceneById(movieId, config),
      this.native.scenes(config),
    ]);
    if (scene || scenes.some((s) => s.id === movieId || s.stashId === id))
      throw new ConflictException(
        'Whisparr entry removal is not yet confirmed. Check Item History; no deletion will be resent automatically.',
      );
  }
  private async complete(id: string, movieId: number | null) {
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
      outcome: 'WHISPARR_ENTRY_CLEANED',
      whisparrSceneId: movieId,
      filesKept: true,
      projectionPending,
      message:
        movieId === null
          ? 'No Whisparr entry exists. Portal request removed; Stash and files kept.'
          : `Whisparr entry ${movieId} and Portal request removed. Stash and files kept.`,
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
    if (action?.kind !== 'DELETE_WHISPARR_ENTRY') return null;
    if (
      action.state === 'RUNNING' &&
      Date.now() - action.updatedAt.getTime() < 2 * 60_000
    )
      throw new ConflictException(
        'The entry deletion may still be running. Wait before checking its outcome.',
      );
    if (!action.dispatchedAt) {
      await this.operations.recoverUnsent(id, action.id);
      return {
        outcome: 'NOT_SENT',
        message:
          'The interrupted deletion was not sent. A fresh review is required.',
      };
    }
    const details = action.details as unknown as {
      operation: string;
      connectionHash: string;
      catalogHash: string;
      scene: DeletionScene;
    };
    const current = await this.connection();
    if (
      details?.operation !== 'DELETE_WHISPARR_ENTRY' ||
      details.scene?.stashId !== id ||
      details.connectionHash !== current.connectionHash ||
      details.catalogHash !== current.catalogHash
    )
      throw new ConflictException(
        'The Whisparr connection or entry identity changed. Restore it before checking the outcome.',
      );
    await this.assertRemoved(id, details.scene.id, current.config);
    const result = await this.complete(id, details.scene.id);
    await this.operations.finish(id, action.id, 'SUCCEEDED', result);
    return result;
  }
}
