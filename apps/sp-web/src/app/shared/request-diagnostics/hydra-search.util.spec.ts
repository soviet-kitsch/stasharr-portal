import { describe, expect, it } from 'vitest';
import { hydraLink, hydraQuery } from './hydra-search.util';

describe('Hydra search builder', () => {
  it('combines checked terms, omits missing values and removes duplicate names', () => {
    expect(
      hydraQuery(
        { studio: ' Studio  Name ', performers: [], title: 'Scene' },
        {
          studio: true,
          title: false,
          performers: ['Example, Performer', 'Example, Performer', ''],
        },
      ),
    ).toBe('Studio Name Example, Performer');
  });
  it('preserves a proxy prefix, encodes terms and preselects XXX in the browser form', () => {
    const url = new URL(hydraLink('https://media.test/hydra', 'Example & Another')!);
    expect(url.pathname).toBe('/hydra/');
    expect(url.searchParams.get('query')).toBe('Example & Another');
    expect(url.searchParams.get('category')).toBe('XXX');
    expect(url.searchParams.has('apikey')).toBe(false);
    expect(url.searchParams.has('indexers')).toBe(false);
  });
  it('rejects empty searches, unsafe schemes and embedded credentials', () => {
    expect(hydraLink('javascript:alert(1)', 'scene')).toBeNull();
    expect(hydraLink('https://user:pass@host', 'scene')).toBeNull();
    expect(hydraLink('https://host', ' ')).toBeNull();
  });
});
