import {
  appendBrowserPath,
  integrationBrowserBaseUrl,
  normalizeBrowserUrl,
} from './browser-url.util';

describe('browser addresses', () => {
  it('keeps a reverse proxy prefix and encodes scene paths separately', () => {
    const base = integrationBrowserBaseUrl({
      browserUrl: 'https://media.example/stash/',
      baseUrl: 'http://stash:9999/graphql',
    });
    expect(base).toBe('https://media.example/stash');
    expect(appendBrowserPath(base!, 'scenes/42')).toBe(
      'https://media.example/stash/scenes/42',
    );
  });

  it('sanitizes legacy API addresses before using them as browser links', () => {
    expect(
      integrationBrowserBaseUrl({
        baseUrl:
          'http://user:secret@stash:9999/prefix/graphql?apikey=secret#private',
      }),
    ).toBe('http://stash:9999/prefix');
  });

  it.each([
    'javascript:alert(1)',
    'ftp://example.com',
    'https://user:secret@example.com',
    'https://example.com?apikey=secret',
    'https://example.com#secret',
    '//example.com',
  ])('rejects unsafe explicit browser addresses %s', (value) => {
    expect(normalizeBrowserUrl(value)).toBeNull();
    expect(
      integrationBrowserBaseUrl({
        browserUrl: value,
        baseUrl: 'http://internal',
      }),
    ).toBeNull();
  });
});
