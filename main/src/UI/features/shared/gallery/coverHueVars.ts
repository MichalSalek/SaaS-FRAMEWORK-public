// UI/features/shared/gallery/coverHueVars.ts
// Deterministic OKLCH cover-hue CSS variables derived from a stylist's name/seed.
// Pure function (no styles/CSS imports) — returns CSSProperties with
// `--cover-hue` / `--cover-hue-2` custom properties consumed by multiple
// surfaces (StylistExhibitHero via StylistGalleryPage.module.css,
// StylistProfileHeader via StylistProfilePage.module.css).
//
// DECISION (nie usuwaj tego komentarza):
// Extracted from StylistExhibitHero.tsx to a shared module so both the gallery
// hero and the stylist profile header consume one source of truth for cover
// hues without a cross-feature import (stylist/ → gallery/). The component
// StylistExhibitHero stays in features/gallery/ and imports this helper.

import { type CSSProperties } from 'react';

const COVER_PALETTE = [
  ['oklch(0.78 0.14 32)', 'oklch(0.72 0.10 28)'], // warm coral
  ['oklch(0.75 0.13 18)', 'oklch(0.68 0.11 8)'], // rose blush
  ['oklch(0.82 0.10 76)', 'oklch(0.74 0.09 86)'], // peach
  ['oklch(0.85 0.08 158)', 'oklch(0.76 0.08 168)'], // sage
  ['oklch(0.80 0.10 248)', 'oklch(0.72 0.12 258)'], // periwinkle
  ['oklch(0.84 0.07 312)', 'oklch(0.75 0.10 322)'], // mauve
  ['oklch(0.78 0.10 88)', 'oklch(0.74 0.09 70)'], // butter
  ['oklch(0.80 0.10 198)', 'oklch(0.74 0.11 188)'], // mint
] as const;

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function coverHueVars(seed: string): CSSProperties {
  const idx = hashStr(seed) % COVER_PALETTE.length;
  const pair = COVER_PALETTE[idx] ?? COVER_PALETTE[0];
  const [a, b] = pair;
  return {
    ['--cover-hue']: a,
    ['--cover-hue-2']: b,
  } as CSSProperties;
}
