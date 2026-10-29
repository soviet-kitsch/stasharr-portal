export interface HydraSettings {
  browserUrl: string;
  studio: boolean;
  performers: boolean;
  title: boolean;
}
export interface HydraTerms {
  studio: string;
  performers: string[];
  title: string;
}
export function hydraQuery(
  terms: HydraTerms,
  choices: { studio: boolean; title: boolean; performers: string[] },
): string {
  return [
    ...new Set(
      [
        ...(choices.studio ? [terms.studio] : []),
        ...choices.performers,
        ...(choices.title ? [terms.title] : []),
      ]
        .map((s) => s.trim().replace(/\s+/g, ' '))
        .filter(Boolean),
    ),
  ].join(' ');
}
export function hydraLink(base: string, query: string): string | null {
  if (!query.trim()) return null;
  try {
    const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.pathname = url.pathname.replace(/\/*$/, '/');
    url.search = '';
    url.hash = '';
    url.searchParams.set('query', query.trim());
    url.searchParams.set('category', 'XXX');
    return url.toString();
  } catch {
    return null;
  }
}
