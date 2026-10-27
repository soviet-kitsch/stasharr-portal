import { newOperationKey } from './operation-key';

describe('request action keys on LAN HTTP', () => {
  it('generates valid, distinct UUIDs without requiring the secure-context randomUUID API', () => {
    const randomUUID = vi.fn(() => {
      throw new Error('Unavailable over LAN HTTP');
    });
    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    vi.stubGlobal('crypto', { randomUUID, getRandomValues });
    try {
      const keys = Array.from({ length: 10 }, () => newOperationKey());
      expect(new Set(keys).size).toBe(10);
      for (const key of keys)
        expect(key).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
      expect(randomUUID).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
