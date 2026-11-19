/**
 * Fonts of the stylist OG card, read from disk by the OG route at request time.
 * Server-only (node fs); imported by pages/api/og/stylist/[identifier].ts.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { OG_FONT_FAMILY, OG_WORDMARK_FONT_FAMILY } from './ogCard.builders';

// DECISION: the card uses the brand faces (Schibsted Grotesk 500/600, Marcellus 400 for the
// wordmark), not @vercel/og's Geist. satori reads TTF/OTF/WOFF but never WOFF2, so next/font
// files cannot be reused; the upstream OFL TTFs live in main/server-assets/og-fonts/ (outside
// public/ and node_modules), are read relative to process.cwd() and reach standalone through
// this route's outputFileTracingIncludes rule in next.config.mjs. A failed read clears the
// cache and throws into the route's try → 302 to the static card.
export const OG_FONT_DIR = join(process.cwd(), 'server-assets', 'og-fonts');
export const OG_FONT_FILES = [
  { file: 'SchibstedGrotesk-Medium.ttf', name: OG_FONT_FAMILY, weight: 500 },
  { file: 'SchibstedGrotesk-SemiBold.ttf', name: OG_FONT_FAMILY, weight: 600 },
  { file: 'Marcellus-Regular.ttf', name: OG_WORDMARK_FONT_FAMILY, weight: 400 },
] as const;

type OgFont = {
  name: string;
  data: Buffer;
  weight: (typeof OG_FONT_FILES)[number]['weight'];
  style: 'normal';
};
let fontsPromise: Promise<OgFont[]> | null = null;
export function loadOgFonts(): Promise<OgFont[]> {
  if (fontsPromise === null) {
    fontsPromise = Promise.all(
      OG_FONT_FILES.map(async ({ file, name, weight }) => ({
        name,
        data: await readFile(join(OG_FONT_DIR, file)),
        weight,
        style: 'normal' as const,
      }))
    ).catch((error: unknown) => {
      fontsPromise = null;
      throw error;
    });
  }
  return fontsPromise;
}
