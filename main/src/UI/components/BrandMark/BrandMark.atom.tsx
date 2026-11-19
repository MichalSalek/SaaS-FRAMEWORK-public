import Image from 'next/image';
import { LP_ASSETS } from '../../assets/lpAssets';
/**
 * BrandMarkAtom: SSOT of the brand mark (the „nf" sign).
 *
 * The ONLY source of the path and rendering of the official brand mark. Every shell (navbar,
 * account rail, footer, login, system screens) renders the brand THROUGH this atom, so a logo
 * change (file / format / intrinsic size) is one edit.
 * The size is NOT set here; the consumer's `className` drives it (it is layout-specific: smaller
 * in the compact bar, larger on a masthead).
 * A11y: the mark is DECORATIVE by default (`alt=''`), because it usually stands beside the
 * „Nailfolio" wordmark, which carries the name for readers. On surfaces without the brand text
 * beside it (a system screen without a wordmark) pass `label`, and the mark becomes the only
 * carrier of the name.
 */

/** SSOT of the brand-mark path: reuse it when only the path is needed (e.g. a preload). */
export const BRAND_MARK_SRC = LP_ASSETS.seo.logo;

/** Intrinsic file dimensions (palette PNG 512x512), for a CLS-safe reservation. */
const BRAND_MARK_INTRINSIC = 512;

/* DECISION: the mark is drawn at 28-38 CSS px on every surface, yet the bare <img> shipped the
 * 512px source (25 KB) to each; it now goes through the image optimizer, `sizes` being the largest
 * drawn width with headroom. The SOURCE stays `/logo.png` (Organization JSON-LD, OG cards and
 * e-mails read the file itself). A surface drawing the mark larger than BRAND_MARK_SIZES must pass
 * its own `sizes`. Quality 90: the mark is flat color with hard edges, where WebP at 75 rings
 * visibly. */
const BRAND_MARK_SIZES = '40px';

export interface BrandMarkAtomProps {
  /** Class that drives the SIZE (height/width); the size is per place. */
  className?: string;
  /**
   * Accessible name. Omit it (decorative `alt=''`) when the „Nailfolio" text stands beside it.
   * Pass it (e.g. „Nailfolio") when the mark is the only carrier of the brand.
   */
  label?: string;
  /** Drawn width hint for the optimizer; default fits every surface today. */
  sizes?: string;
}

export function BrandMarkAtom({
  className,
  label,
  sizes = BRAND_MARK_SIZES,
}: BrandMarkAtomProps) {
  return (
    <Image
      src={BRAND_MARK_SRC}
      alt={label ?? ''}
      width={BRAND_MARK_INTRINSIC}
      height={BRAND_MARK_INTRINSIC}
      sizes={sizes}
      quality={90}
      // The mark stands in the first screen's header: no lazy-load wait.
      loading='eager'
      className={className}
      draggable={false}
    />
  );
}
