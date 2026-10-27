export interface IntegrationBrowserAddress {
  browserUrl?: string | null;
  baseUrl?: string | null;
}

/** Browser links never carry API credentials or connection query parameters. */
export function normalizeBrowserUrl(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function integrationBrowserBaseUrl(
  integration: IntegrationBrowserAddress,
): string | null {
  const explicit = integration.browserUrl?.trim();
  if (explicit) return normalizeBrowserUrl(explicit);
  const fallback = integration.baseUrl?.trim();
  if (!fallback) return null;
  try {
    const parsed = new URL(fallback);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    parsed.pathname = parsed.pathname.replace(/\/graphql\/?$/, '');
    return normalizeBrowserUrl(parsed.toString());
  } catch {
    return null;
  }
}

export function appendBrowserPath(
  baseUrl: string,
  path: string,
): string | null {
  const normalized = normalizeBrowserUrl(baseUrl);
  if (!normalized) return null;
  return `${normalized}/${path.replace(/^\/+/, '')}`;
}
