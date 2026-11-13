interface StudioOption {
  id: string;
  name: string;
  childStudios?: Array<{ id: string; name: string }>;
}

const NETWORK_PREFIX = 'network:';

export function isStudioNetwork(value: string | null): value is string {
  return value?.startsWith(NETWORK_PREFIX) === true;
}

export function studioNetworkValue(id: string): string {
  return `${NETWORK_PREFIX}${id}`;
}

export function studioOptionsForGroup(
  studio: StudioOption,
): Array<{ label: string; value: string }> {
  const children = studio.childStudios ?? [];
  const options = [{ label: studio.name, value: studio.id }];
  if (children.length > 0) {
    options.unshift({
      label: `${studio.name} (whole network)`,
      value: studioNetworkValue(studio.id),
    });
    options.push(...children.map((child) => ({ label: child.name, value: child.id })));
  }
  return options;
}
