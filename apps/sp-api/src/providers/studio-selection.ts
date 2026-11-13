import { BadGatewayException, BadRequestException } from '@nestjs/common';

const NETWORK_PREFIX = 'network:';
const LOOKUP_BATCH_SIZE = 20;

export function studioNetworkValue(studioId: string): string {
  return NETWORK_PREFIX + studioId;
}

export function hasStudioNetworks(values: string[]): boolean {
  return values.some((value) => value.startsWith(NETWORK_PREFIX));
}

// Both providers expose findStudio and its immediate children. Expand before querying
// scenes so network membership participates in sorting, counts and pagination.
export async function resolveStudioSelection(
  values: string[],
  query: (
    document: string,
    variables: Record<string, string>,
  ) => Promise<unknown>,
): Promise<string[]> {
  const studioIds = new Set<string>();
  const networkIds = new Set<string>();

  for (const value of values) {
    const selection = value.trim();
    if (!selection) continue;
    if (hasStudioNetworks([selection])) {
      const id = selection.slice(NETWORK_PREFIX.length).trim();
      if (!id) throw new BadRequestException('Studio network ID is required.');
      studioIds.add(id);
      networkIds.add(id);
    } else {
      studioIds.add(selection);
    }
  }

  const pending = [...networkIds];
  for (let offset = 0; offset < pending.length; ) {
    const batch = pending.slice(offset, offset + LOOKUP_BATCH_SIZE);
    offset += batch.length;
    const variables = Object.fromEntries(
      batch.map((id, index) => [`studio${index}`, id]),
    );
    const declarations = batch.map((_, index) => `$studio${index}: ID!`);
    const fields = batch.map(
      (_, index) =>
        `studio${index}: findStudio(id: $studio${index}) { child_studios { id } }`,
    );
    const data = (await query(
      `query StudioNetworkChildren(${declarations.join(', ')}) { ${fields.join(' ')} }`,
      variables,
    )) as
      | Record<string, { child_studios?: Array<{ id?: unknown }> } | null>
      | undefined;

    for (let index = 0; index < batch.length; index += 1) {
      const studio = data?.[`studio${index}`];
      if (studio === null) continue;
      if (!Array.isArray(studio?.child_studios)) {
        throw new BadGatewayException(
          'Studio network membership could not be loaded.',
        );
      }
      for (const child of studio.child_studios) {
        const id = typeof child?.id === 'string' ? child.id.trim() : '';
        if (!id)
          throw new BadGatewayException(
            'Studio network returned an invalid studio ID.',
          );
        studioIds.add(id);
        if (!networkIds.has(id)) {
          networkIds.add(id);
          pending.push(id);
        }
      }
    }
  }
  return [...studioIds];
}
