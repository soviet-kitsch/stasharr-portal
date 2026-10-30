import { BadRequestException, Injectable } from '@nestjs/common';
import { IntegrationsService } from '../integrations/integrations.service';
import { CatalogProviderService } from '../providers/catalog/catalog-provider.service';
import { StashAdapter } from '../providers/stash/stash.adapter';
import {
  appendBrowserPath,
  integrationBrowserBaseUrl,
} from '../integrations/browser-url.util';

@Injectable()
export class StashAvailabilityService {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly catalogs: CatalogProviderService,
    private readonly stash: StashAdapter,
  ) {}
  async check(rawId: string) {
    const sceneId = rawId.trim().toLowerCase();
    if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(sceneId))
      throw new BadRequestException('A valid catalog scene ID is required.');
    const result = (
      state: string,
      summary: string,
      matches: {
        id: string;
        label: string;
        viewUrl: string;
        evidence: string;
      }[] = [],
      libraryUrl: string | null = null,
    ) => ({
      sceneId,
      state,
      summary,
      matches,
      libraryUrl,
      checkedAt: new Date().toISOString(),
      limitation:
        'This checks Stash records and listed files, not filesystem readability. An unidentified file may be present without a matching catalog link.',
    });
    try {
      const config = await this.integrations.findOne('STASH');
      const browserBase = integrationBrowserBaseUrl(config);
      const libraryUrl = browserBase
        ? appendBrowserPath(browserBase, 'scenes')
        : null;
      if (!config.enabled || config.status !== 'CONFIGURED' || !config.baseUrl)
        return result(
          'NOT_CONFIGURED',
          'Connect Stash to check current availability.',
          [],
          libraryUrl,
        );
      const providerKey = await this.catalogs.getInstanceCatalogProviderType();
      if (!providerKey)
        return result(
          'NOT_CONFIGURED',
          'Choose a catalog provider so Stash links can be matched.',
          [],
          libraryUrl,
        );
      const matches = await this.stash.findScenesByStashId(
        sceneId,
        {
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          browserUrl: config.browserUrl,
        },
        { providerKey, requireComplete: true },
      );
      return result(
        matches.length ? 'AVAILABLE' : 'NOT_FOUND',
        matches.length
          ? 'Available in Stash. A matching scene with a listed file was found.'
          : 'No matching scene with a listed file was found. If the download is already imported, identify it in Stash and check again.',
        matches.map((m) => ({
          id: m.id,
          label: m.label,
          viewUrl: m.viewUrl,
          evidence: m.evidence ?? 'CATALOG_ID',
        })),
        libraryUrl,
      );
    } catch {
      return result(
        'UNAVAILABLE',
        'The current Stash match lookup could not be completed. Availability is unknown; this does not mean the scene is missing.',
      );
    }
  }
}
