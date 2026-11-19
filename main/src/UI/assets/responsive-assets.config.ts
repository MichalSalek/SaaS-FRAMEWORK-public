import variants from './responsive-asset-variants.json';
import { refreshedAsset } from './brandAssets';

interface ResponsiveVariant {
  width: number;
  src: string;
}

interface ResponsiveVariantSet {
  avif: ResponsiveVariant[];
  webp: ResponsiveVariant[];
}

const sets: Readonly<Record<string, ResponsiveVariantSet>> = variants;

export interface ResponsiveImageSources {
  /** `srcset` of the AVIF `<source>`. */
  avifSrcSet: string;
  /** `srcset` of the WebP `<img>`, the fallback for browsers without AVIF. */
  webpSrcSet: string;
  /** Plain `src` for a browser that reads no `srcset`: the widest WebP. */
  fallbackSrc: string;
}

const toSrcSet = (list: ResponsiveVariant[]): string =>
  list.map(v => `${refreshedAsset(v.src)} ${v.width}w`).join(', ');

/**
 * Static fixed-width AVIF and WebP files cut by `npm run assets:sync` for a
 * library asset whose manifest entry opts in with `responsive.widths`
 * (DECISION in scripts/assets/library.mjs). `undefined` means the asset has
 * none, so the caller keeps `next/image`. The list is generated next to the
 * files themselves, so a path here always exists on disk (`audit:asset-paths`
 * checks it as well).
 */
export function responsiveImageSources(
  src: string
): ResponsiveImageSources | undefined {
  const set = sets[src.split('?')[0] ?? src];
  const widest = set?.webp.at(-1);
  if (set === undefined || widest === undefined || set.avif.length === 0) {
    return undefined;
  }
  return {
    avifSrcSet: toSrcSet(set.avif),
    webpSrcSet: toSrcSet(set.webp),
    fallbackSrc: refreshedAsset(widest.src),
  };
}
