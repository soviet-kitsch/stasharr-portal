import { createHash } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { IntegrationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StashdbAdapter } from '../stashdb/stashdb.adapter';
import { CatalogProviderKey } from './catalog-provider.util';

export interface CatalogSourceIdentity {
  urls: string[];
  studioId: string;
  duration: number;
}

// Keep query parameters: different scene IDs on the same page are not aliases.
export function sceneSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    if (
      url.pathname.split('/').filter(Boolean).length < 2 &&
      !/\d{4,}/.test(url.pathname + url.search)
    )
      return null;
    if (
      /\/(?:scenes|videos|performers|models|studios|search|categories)\/?$/i.test(
        url.pathname,
      )
    )
      return null;
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    url.searchParams.sort();
    return url.toString();
  } catch {
    return null;
  }
}

@Injectable()
export class CatalogSourceIdentityService {
  private readonly cache = new Map<
    string,
    { expiresAt: number; value: Promise<CatalogSourceIdentity | null> }
  >();
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: StashdbAdapter,
  ) {}

  async get(
    id: string,
    provider: CatalogProviderKey,
  ): Promise<CatalogSourceIdentity | null> {
    const config = await this.prisma.integrationConfig.findUnique({
      where: { type: provider },
    });
    if (
      !config?.enabled ||
      config.status !== IntegrationStatus.CONFIGURED ||
      !config.baseUrl
    )
      return null;
    const key = createHash('sha256')
      .update(JSON.stringify([provider, config.baseUrl, config.apiKey, id]))
      .digest('hex');
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (this.cache.size >= 256)
      this.cache.delete(this.cache.keys().next().value!);
    const value = this.load(id, {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
    });
    this.cache.set(key, { expiresAt: Date.now() + 60_000, value });
    try {
      return await value;
    } catch (error) {
      this.cache.delete(key);
      throw error;
    }
  }

  private async load(
    id: string,
    config: { baseUrl: string; apiKey: string | null },
  ): Promise<CatalogSourceIdentity | null> {
    const scene = await this.catalog.getSceneById(id, config).catch((error) => {
      if (error instanceof NotFoundException) return null;
      throw error;
    });
    if (!scene) return null;
    const urls = [
      ...new Set(
        (scene.sourceUrls ?? [])
          .map((item) => sceneSourceUrl(item.url))
          .filter((url): url is string => !!url),
      ),
    ].slice(0, 3);
    if (
      !scene.studioId ||
      !scene.duration ||
      scene.duration <= 0 ||
      !urls.length
    )
      return null;
    return { urls, studioId: scene.studioId, duration: scene.duration };
  }
}
