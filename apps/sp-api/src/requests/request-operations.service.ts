import {
  ConflictException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type RequestActionKind =
  | 'REQUEST'
  | 'RE_REQUEST'
  | 'SEARCH'
  | 'DIAGNOSTIC_SEARCH'
  | 'DELETE_WHISPARR_ENTRY'
  | 'DELETE_WHISPARR'
  | 'DISMISS'
  | 'RESTORE';
export type BeforeDispatch = (
  details?: Prisma.InputJsonObject,
) => Promise<void>;

@Injectable()
export class RequestOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T extends object>(
    stashId: string,
    key: string,
    kind: RequestActionKind,
    payload: object,
    work: (beforeDispatch: BeforeDispatch) => Promise<T>,
  ): Promise<T> {
    const payloadHash = createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
    const claim = await this.prisma.$transaction(async (tx) => {
      const previous = await tx.requestAction.findUnique({
        where: { id: key },
      });
      if (previous) {
        if (
          previous.stashId !== stashId ||
          previous.kind !== kind ||
          previous.payloadHash !== payloadHash
        ) {
          throw new ConflictException(
            'This action key belongs to a different action. Start a new action.',
          );
        }
        if (previous.state === 'SUCCEEDED') return { replay: previous.result };
        throw new ConflictException({
          message:
            previous.state === 'FAILED'
              ? 'The previous attempt failed before sending. Start a new action to retry.'
              : 'This action is running or its outcome is uncertain. Check its outcome before retrying.',
          actionState: previous.state,
        });
      }
      await tx.request.upsert({
        where: { stashId },
        create: { stashId },
        update: {},
      });
      const locked = await tx.request.updateMany({
        where: { stashId, activeActionId: null },
        data: { activeActionId: key },
      });
      if (!locked.count)
        throw new ConflictException(
          'Another action is running or awaiting an outcome check for this scene.',
        );
      await tx.requestAction.create({
        data: { id: key, stashId, kind, payloadHash },
      });
      return { replay: null };
    });
    if (claim.replay) return claim.replay as T;

    let dispatched = false;
    const beforeDispatch: BeforeDispatch = async (details = {}) => {
      const marked = await this.prisma.requestAction.updateMany({
        where: { id: key, state: 'RUNNING' },
        data: { dispatchedAt: new Date(), details },
      });
      if (marked.count !== 1)
        throw new ConflictException(
          'This action is no longer active. Refresh before continuing.',
        );
      dispatched = true;
    };
    try {
      const result = await work(beforeDispatch);
      await this.finish(stashId, key, 'SUCCEEDED', result);
      return result;
    } catch (error) {
      // A sent request may have succeeded remotely even if the response or local
      // commit failed. Keep its durable claim; never expire and blindly resend it.
      try {
        await this.finish(stashId, key, dispatched ? 'UNCERTAIN' : 'FAILED', {
          outcome: dispatched ? 'OUTCOME_UNKNOWN' : 'NOT_SENT',
        });
      } catch {
        /* The original persisted claim remains the conservative fallback. */
      }
      if (dispatched)
        throw new ConflictException(
          'The action may have reached Whisparr. Check its outcome before retrying; it has not been sent again.',
        );
      if (error instanceof HttpException)
        throw new HttpException(
          { message: error.message, actionState: 'FAILED' },
          error.getStatus(),
        );
      throw new ServiceUnavailableException({
        message:
          'The action could not be verified before sending. It is safe to start a new attempt.',
        actionState: 'FAILED',
      });
    }
  }

  async finish(
    stashId: string,
    key: string,
    state: 'SUCCEEDED' | 'FAILED' | 'UNCERTAIN',
    result: object,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.request.findUnique({ where: { stashId } });
      if (claim?.activeActionId !== key)
        throw new ConflictException(
          'Action ownership changed. Refresh before continuing.',
        );
      await tx.requestAction.update({
        where: { id: key },
        data: { state, result: result as Prisma.InputJsonObject },
      });
      if (state !== 'UNCERTAIN')
        await tx.request.update({
          where: { stashId },
          data: { activeActionId: null },
        });
    });
  }

  async recoverUnsent(stashId: string, key: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const request = await tx.request.findUnique({ where: { stashId } });
      if (request?.activeActionId !== key)
        throw new ConflictException('The action changed. Refresh its history.');
      const recovered = await tx.requestAction.updateMany({
        where: {
          id: key,
          state: 'RUNNING',
          dispatchedAt: null,
          updatedAt: { lte: new Date(Date.now() - 2 * 60_000) },
        },
        data: { state: 'FAILED', result: { outcome: 'NOT_SENT' } },
      });
      if (recovered.count !== 1)
        throw new ConflictException(
          'The action changed or may have been sent. Its claim is retained.',
        );
      await tx.request.update({
        where: { stashId },
        data: { activeActionId: null },
      });
    });
  }
}
