import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { PrismaService } from '../prisma/prisma.service';
import { RuntimeHealthService } from '../runtime-health/runtime-health.service';
import { StashAdapter } from '../providers/stash/stash.adapter';
import { StashdbAdapter } from '../providers/stashdb/stashdb.adapter';
import { WhisparrAdapter } from '../providers/whisparr/whisparr.adapter';

describe('integration presentation and request defaults', () => {
  const original = {
    type: IntegrationType.STASHDB,
    enabled: true,
    name: null,
    baseUrl: 'https://stashdb.org/graphql',
    apiKey: 'preserved-secret',
    browserUrl: null as string | null,
    defaultRootFolderPath: null as string | null,
    defaultQualityProfileId: null as number | null,
    status: IntegrationStatus.CONFIGURED,
    lastHealthyAt: new Date('2026-10-27T10:00:00Z'),
    lastErrorAt: null,
    lastErrorMessage: null,
  };
  function fixture(existing = original) {
    const update = jest
      .fn()
      .mockImplementation(async (args) => ({ ...existing, ...args.data }));
    const upsert = jest.fn();
    const transaction = jest.fn();
    const testConnection = jest.fn();
    const clearService = jest.fn();
    const getRootFolders = jest
      .fn()
      .mockResolvedValue([{ id: 1, path: '/data/library', accessible: true }]);
    const getQualityProfiles = jest
      .fn()
      .mockResolvedValue([{ id: 7, name: 'HD' }]);
    const service = new IntegrationsService(
      {
        integrationConfig: {
          findUnique: jest.fn().mockResolvedValue(existing),
          update,
          upsert,
        },
        $transaction: transaction,
      } as unknown as PrismaService,
      { testConnection } as unknown as StashAdapter,
      { testConnection } as unknown as StashdbAdapter,
      {
        testConnection,
        getRootFolders,
        getQualityProfiles,
      } as unknown as WhisparrAdapter,
      { clearService } as unknown as RuntimeHealthService,
    );
    return {
      service,
      update,
      upsert,
      transaction,
      testConnection,
      clearService,
      getRootFolders,
      getQualityProfiles,
    };
  }

  it('changes only the browser address without retesting, changing catalog choice or clearing health', async () => {
    const f = fixture();
    const result = await f.service.upsert(IntegrationType.STASHDB, {
      browserUrl: 'https://catalog.example/prefix/',
    });
    expect(f.update).toHaveBeenCalledWith({
      where: { type: IntegrationType.STASHDB },
      data: {
        browserUrl: 'https://catalog.example/prefix',
        defaultRootFolderPath: null,
        defaultQualityProfileId: null,
      },
    });
    expect(result.apiKey).toBe(original.apiKey);
    expect(result.status).toBe(original.status);
    expect(result.lastHealthyAt).toEqual(original.lastHealthyAt);
    expect(f.transaction).not.toHaveBeenCalled();
    expect(f.upsert).not.toHaveBeenCalled();
    expect(f.testConnection).not.toHaveBeenCalled();
    expect(f.clearService).not.toHaveBeenCalled();
  });

  it('keeps a disabled catalog and its existing error history when only its browser address changes', async () => {
    const f = fixture({
      ...original,
      enabled: false,
      status: IntegrationStatus.ERROR,
      lastErrorMessage: 'Existing connection issue',
    } as typeof original);
    const result = await f.service.upsert(IntegrationType.STASHDB, {
      browserUrl: 'https://catalog.example',
      enabled: true,
    });
    expect(result.enabled).toBe(false);
    expect(result.status).toBe(IntegrationStatus.ERROR);
    expect(result.lastErrorMessage).toBe('Existing connection issue');
    expect(f.transaction).not.toHaveBeenCalled();
    expect(f.clearService).not.toHaveBeenCalled();
  });

  it('clears browser override explicitly and redacts stored credentials from responses', async () => {
    const f = fixture({
      ...original,
      browserUrl: 'https://old.example',
    } as typeof original);
    const result = await new IntegrationsController(f.service).update(
      'STASHDB',
      { browserUrl: null },
    );
    expect(result.browserUrl).toBeNull();
    expect(result.hasApiKey).toBe(true);
    expect(JSON.stringify(result)).not.toContain(original.apiKey);
    expect(result).not.toHaveProperty('apiKey');
  });

  it.each([
    'https://user:password@example.com',
    'https://example.com?token=secret',
    'javascript:alert(1)',
  ])('rejects unsafe browser URL %s before writing', async (browserUrl) => {
    const f = fixture();
    await expect(
      f.service.upsert(IntegrationType.STASHDB, { browserUrl }),
    ).rejects.toThrow('Browser URL must');
    expect(f.update).not.toHaveBeenCalled();
    expect(f.upsert).not.toHaveBeenCalled();
  });

  it('stores Portal defaults without changing the Whisparr connection or its native settings', async () => {
    const f = fixture({
      ...original,
      type: IntegrationType.WHISPARR,
    } as typeof original);
    const result = await f.service.upsert(IntegrationType.WHISPARR, {
      defaultRootFolderPath: '/data/library',
      defaultQualityProfileId: 7,
    });
    expect(result.defaultRootFolderPath).toBe('/data/library');
    expect(result.defaultQualityProfileId).toBe(7);
    expect(f.testConnection).not.toHaveBeenCalled();
    expect(f.getRootFolders).not.toHaveBeenCalled();
    await f.service.upsert(IntegrationType.WHISPARR, {
      defaultRootFolderPath: null,
      defaultQualityProfileId: null,
    });
    expect(f.update.mock.calls[1][0].data.defaultRootFolderPath).toBeNull();
  });

  it('loads choices using the internal API address and preserved key, never the browser address', async () => {
    const f = fixture({
      ...original,
      type: IntegrationType.WHISPARR,
      browserUrl: 'https://browser.example',
    } as typeof original);
    const options = await f.service.getWhisparrDefaultOptions();
    expect(options.qualityProfiles[0].id).toBe(7);
    expect(f.getRootFolders).toHaveBeenCalledWith({
      baseUrl: original.baseUrl,
      apiKey: original.apiKey,
    });
    expect(f.update).not.toHaveBeenCalled();
  });

  it('rejects defaults for another integration and invalid paths/profile IDs', async () => {
    const f = fixture();
    await expect(
      f.service.upsert(IntegrationType.STASH, { defaultQualityProfileId: 7 }),
    ).rejects.toThrow('only to Whisparr');
    await expect(
      f.service.upsert(IntegrationType.WHISPARR, {
        defaultRootFolderPath: 'relative/path',
      }),
    ).rejects.toThrow('absolute path');
    await expect(
      f.service.upsert(IntegrationType.WHISPARR, {
        defaultQualityProfileId: 1.5,
      }),
    ).rejects.toThrow('positive integer');
    expect(f.update).not.toHaveBeenCalled();
  });
});
