import {
  BadGatewayException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { fetchWithTimeout } from '../fetch-with-timeout';
import { WhisparrAdapterBaseConfig } from './whisparr.adapter';

export interface DeletionScene {
  id: number;
  stashId: string | null;
  title: string;
  path: string;
  hasFile: boolean;
  added: string;
}
export interface DeletionFile {
  id: number;
  movieId: number;
  path: string;
  size: number;
  dateAdded: string;
}
export interface DeletionRoot {
  path: string;
  accessible: boolean;
}

@Injectable()
export class WhisparrSceneDeletionAdapter {
  private endpoint(config: WhisparrAdapterBaseConfig, path: string) {
    const url = new URL(config.baseUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new BadGatewayException('Invalid Whisparr connection URL.');
    url.pathname = url.pathname.replace(/\/+$/, '') + '/api/v3/' + path;
    url.search = '';
    url.hash = '';
    return url;
  }
  private async read(
    url: URL,
    config: WhisparrAdapterBaseConfig,
    missing = false,
  ): Promise<unknown> {
    try {
      const response = await fetchWithTimeout(url, {
        method: 'GET',
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          ...(config.apiKey ? { 'X-Api-Key': config.apiKey } : {}),
        },
      });
      if (missing && response.status === 404) return null;
      if (!response.ok) throw new Error('Upstream read rejected');
      return await response.json();
    } catch {
      throw new BadGatewayException(
        'Whisparr deletion evidence could not be read completely. No deletion was sent by this read.',
      );
    }
  }
  private list(value: unknown): Record<string, unknown>[] {
    if (
      !Array.isArray(value) ||
      value.length > 5000 ||
      value.some((v) => !v || typeof v !== 'object' || Array.isArray(v))
    )
      throw new BadGatewayException(
        'Whisparr deletion evidence is incomplete or too large.',
      );
    return value;
  }
  private positive(value: unknown) {
    return (
      typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    );
  }
  private scene(value: unknown): DeletionScene {
    const row = value as Record<string, unknown>;
    if (
      !row ||
      !this.positive(row.id) ||
      typeof row.path !== 'string' ||
      !row.path ||
      typeof row.hasFile !== 'boolean' ||
      typeof row.added !== 'string'
    )
      throw new BadGatewayException(
        'Whisparr scene identity or folder evidence is incomplete.',
      );
    return {
      id: row.id as number,
      stashId:
        typeof row.stashId === 'string' ? row.stashId.toLowerCase() : null,
      title: typeof row.title === 'string' ? row.title : '',
      path: row.path,
      hasFile: row.hasFile,
      added: row.added,
    };
  }
  async scenes(config: WhisparrAdapterBaseConfig): Promise<DeletionScene[]> {
    const url = this.endpoint(config, 'movie');
    url.searchParams.set('excludeLocalCovers', 'true');
    const rows = this.list(await this.read(url, config)).map((v) =>
      this.scene(v),
    );
    if (new Set(rows.map((v) => v.id)).size !== rows.length)
      throw new BadGatewayException(
        'Whisparr returned duplicate scene identities.',
      );
    return rows;
  }
  async sceneById(
    id: number,
    config: WhisparrAdapterBaseConfig,
  ): Promise<DeletionScene | null> {
    const value = await this.read(
      this.endpoint(config, 'movie/' + id),
      config,
      true,
    );
    if (value === null) return null;
    const row = this.scene(value);
    if (row.id !== id)
      throw new BadGatewayException('Whisparr scene lookup identity changed.');
    return row;
  }
  async roots(config: WhisparrAdapterBaseConfig): Promise<DeletionRoot[]> {
    return this.list(
      await this.read(this.endpoint(config, 'rootfolder'), config),
    ).map((row) => {
      if (
        typeof row.path !== 'string' ||
        !row.path ||
        typeof row.accessible !== 'boolean'
      )
        throw new BadGatewayException(
          'Whisparr root-folder evidence is incomplete.',
        );
      return { path: row.path, accessible: row.accessible };
    });
  }
  async files(
    id: number,
    config: WhisparrAdapterBaseConfig,
  ): Promise<DeletionFile[]> {
    const url = this.endpoint(config, 'moviefile');
    url.searchParams.set('movieId', String(id));
    const rows = this.list(await this.read(url, config)).map((row) => {
      if (
        !this.positive(row.id) ||
        row.movieId !== id ||
        typeof row.path !== 'string' ||
        !row.path ||
        typeof row.size !== 'number' ||
        !Number.isSafeInteger(row.size) ||
        row.size < 0 ||
        typeof row.dateAdded !== 'string'
      )
        throw new BadGatewayException(
          'Whisparr file identity or path evidence is incomplete.',
        );
      return {
        id: row.id as number,
        movieId: id,
        path: row.path,
        size: row.size,
        dateAdded: row.dateAdded,
      };
    });
    if (new Set(rows.map((v) => v.id)).size !== rows.length)
      throw new BadGatewayException(
        'Whisparr returned duplicate file identities.',
      );
    return rows.sort((a, b) => a.id - b.id);
  }
  async assertIdle(
    id: number,
    config: WhisparrAdapterBaseConfig,
  ): Promise<void> {
    const commands = this.list(
      await this.read(this.endpoint(config, 'command'), config),
    );
    for (const command of commands) {
      if (typeof command.status !== 'string')
        throw new BadGatewayException('Whisparr command status is incomplete.');
      if (
        !['queued', 'started', 'running'].includes(command.status.toLowerCase())
      )
        continue;
      const body = command.body as Record<string, unknown> | undefined;
      const ids =
        body?.movieIds ?? (body?.movieId !== undefined ? [body.movieId] : []);
      if (!Array.isArray(ids) || ids.some((v) => !this.positive(v)))
        throw new BadGatewayException('Whisparr command scope is incomplete.');
      if (!ids.length || ids.includes(id))
        throw new ConflictException(
          'A Whisparr command is active for this scene or has global scope. Wait for it to finish and refresh the preview.',
        );
    }
    const seen = new Set<string>();
    let total: number | undefined;
    for (let page = 1; page <= 100; page++) {
      const url = this.endpoint(config, 'queue');
      url.searchParams.set('page', String(page));
      url.searchParams.set('pageSize', '200');
      const data = (await this.read(url, config)) as Record<string, unknown>;
      if (
        !data ||
        typeof data.totalRecords !== 'number' ||
        !Number.isInteger(data.totalRecords) ||
        data.totalRecords < 0 ||
        data.totalRecords > 5000 ||
        (total !== undefined && data.totalRecords !== total)
      )
        throw new BadGatewayException(
          'Whisparr queue evidence is incomplete or changed.',
        );
      total = data.totalRecords;
      const rows = this.list(data.records);
      for (const row of rows) {
        if (
          !['number', 'string'].includes(typeof row.id) ||
          typeof row.movieId !== 'number' ||
          !Number.isSafeInteger(row.movieId) ||
          row.movieId < 0 ||
          seen.has(String(row.id))
        )
          throw new BadGatewayException(
            'Whisparr queue identity is incomplete.',
          );
        seen.add(String(row.id));
        if (row.movieId === id)
          throw new ConflictException(
            'This scene is queued, downloading or awaiting import in Whisparr. Resolve that transfer before deleting its files.',
          );
      }
      if (seen.size === total) return;
      if (!rows.length || seen.size > total)
        throw new BadGatewayException(
          'Whisparr queue pagination is incomplete.',
        );
    }
    throw new BadGatewayException(
      'Whisparr queue pagination exceeded its limit.',
    );
  }
  async deleteSceneAndFiles(
    id: number,
    config: WhisparrAdapterBaseConfig,
  ): Promise<void> {
    return this.deleteScene(id, config, true);
  }
  async deleteSceneEntry(
    id: number,
    config: WhisparrAdapterBaseConfig,
  ): Promise<void> {
    return this.deleteScene(id, config, false);
  }
  private async deleteScene(
    id: number,
    config: WhisparrAdapterBaseConfig,
    deleteFiles: boolean,
  ): Promise<void> {
    if (!this.positive(id))
      throw new BadGatewayException('Invalid Whisparr scene ID.');
    const url = this.endpoint(config, 'movie/' + id);
    url.searchParams.set('deleteFiles', String(deleteFiles));
    url.searchParams.set('addImportExclusion', 'false');
    // Explicit true/false modes share one transport. Never retry native deletion here.
    try {
      const response = await fetchWithTimeout(url, {
        method: 'DELETE',
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          ...(config.apiKey ? { 'X-Api-Key': config.apiKey } : {}),
        },
      });
      if (!response.ok) throw new Error('Deletion not acknowledged');
    } catch {
      throw new BadGatewayException(
        'Whisparr did not confirm the deletion response. Check the recorded outcome before retrying.',
      );
    }
  }
}
