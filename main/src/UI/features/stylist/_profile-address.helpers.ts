/** City plus street for the public header. A street without a city is not shown. */
export function formatPublicAddress(
  city: string | null | undefined,
  street: string | null | undefined
): string | null {
  const place = city?.trim() ?? '';
  if (place === '') {
    return null;
  }
  const line = street?.trim() ?? '';
  if (line === '') {
    return place;
  }
  return `${place}, ${line}`;
}

export function publicAddressMapHref(address: string): string {
  const params = new URLSearchParams({ api: '1', query: address });
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

/** Reads `address_street` when the public contract carries it. */
export function readAddressStreet(source: object): string | null {
  const value = Object.getOwnPropertyDescriptor(source, 'address_street')
    ?.value as unknown;
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
