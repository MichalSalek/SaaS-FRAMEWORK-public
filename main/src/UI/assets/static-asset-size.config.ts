import dimensions from './static-asset-dimensions.json';

const sizes: Readonly<Record<string, { width: number; height: number }>> =
  dimensions;

/** Native derivative pixels, before the responsive optimizer. Keep large art at Retina density. */
export function staticAssetWidth(src: string, fallback: number): number {
  const pathname = src.split('?')[0] ?? src;
  return sizes[pathname]?.width ?? fallback;
}

export function staticAssetDimensions(
  src: string
): { width: number; height: number } | undefined {
  return sizes[src.split('?')[0] ?? src];
}
