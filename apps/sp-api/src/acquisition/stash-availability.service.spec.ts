import { NotFoundException } from '@nestjs/common';
import { StashAvailabilityService } from './stash-availability.service';
const id = '01a0d367-a37a-779d-9d6c-3c634b17f211';
function setup() {
  const config = {
    enabled: true,
    status: 'CONFIGURED',
    baseUrl: 'http://stash:9999',
    browserUrl: 'https://media.example/stash',
    apiKey: 'synthetic',
  };
  const integrations: any = { findOne: jest.fn(async () => config) };
  const catalogs: any = {
    getInstanceCatalogProviderType: jest.fn(async () => 'STASHDB'),
  };
  const stash: any = {
    findScenesByStashId: jest.fn(async () => [
      {
        id: 'local-1',
        label: 'Stash scene 1',
        viewUrl: 'https://media.example/stash/scenes/local-1',
      },
    ]),
  };
  return {
    config,
    integrations,
    catalogs,
    stash,
    service: new StashAvailabilityService(integrations, catalogs, stash),
  };
}
describe('on-demand Stash availability', () => {
  it('checks Stash independently of Whisparr or an existing request and returns direct copy links', async () => {
    const f = setup();
    const result = await f.service.check(id);
    expect(result.state).toBe('AVAILABLE');
    expect(result.matches[0].viewUrl).toContain('/scenes/local-1');
    expect(f.integrations.findOne.mock.calls).toEqual([['STASH']]);
    expect(f.stash.findScenesByStashId).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ browserUrl: f.config.browserUrl }),
      { providerKey: 'STASHDB', requireComplete: true },
    );
    expect(JSON.stringify(result)).not.toContain('synthetic');
    expect(result.limitation).toContain('not filesystem readability');
  });
  it('distinguishes a complete negative result from an unavailable lookup and explains identification', async () => {
    const f = setup();
    f.stash.findScenesByStashId.mockResolvedValue([]);
    expect(await f.service.check(id)).toMatchObject({
      state: 'NOT_FOUND',
      matches: [],
      summary: expect.stringContaining('identify it in Stash'),
    });
    f.stash.findScenesByStashId.mockRejectedValue(
      new Error('provider unreachable'),
    );
    expect(await f.service.check(id)).toMatchObject({
      state: 'UNAVAILABLE',
      summary: expect.stringContaining('does not mean the scene is missing'),
    });
  });
  it('supports FansDB without mixing catalog namespaces', async () => {
    const f = setup();
    f.catalogs.getInstanceCatalogProviderType.mockResolvedValue('FANSDB');
    await f.service.check(id);
    expect(f.stash.findScenesByStashId.mock.calls[0][2].providerKey).toBe(
      'FANSDB',
    );
  });
  it('preserves stronger source-identity evidence', async () => {
    const f = setup();
    f.stash.findScenesByStashId.mockResolvedValue([
      {
        id: '1',
        label: 'Local scene',
        viewUrl: 'https://media.example/stash/scenes/1',
        evidence: 'SOURCE_IDENTITY',
      },
    ]);
    expect((await f.service.check(id)).matches[0].evidence).toBe(
      'SOURCE_IDENTITY',
    );
  });
  it.each(['disabled', 'unconfigured', 'no catalog'])(
    'returns setup guidance when %s',
    async (reason) => {
      const f = setup();
      if (reason === 'disabled') f.config.enabled = false;
      if (reason === 'unconfigured') f.config.status = 'NOT_CONFIGURED';
      if (reason === 'no catalog')
        f.catalogs.getInstanceCatalogProviderType.mockResolvedValue(null);
      expect((await f.service.check(id)).state).toBe('NOT_CONFIGURED');
      expect(f.stash.findScenesByStashId).not.toHaveBeenCalled();
    },
  );
  it('treats a missing integration record as setup needed, without calling providers', async () => {
    const f = setup();
    f.integrations.findOne.mockRejectedValue(new NotFoundException());
    expect((await f.service.check(id)).state).toBe('NOT_CONFIGURED');
    expect(f.stash.findScenesByStashId).not.toHaveBeenCalled();
  });
  it('rejects invalid scene IDs before any provider call', async () => {
    const f = setup();
    await expect(f.service.check('../invalid')).rejects.toThrow();
    expect(f.integrations.findOne).not.toHaveBeenCalled();
  });
});
