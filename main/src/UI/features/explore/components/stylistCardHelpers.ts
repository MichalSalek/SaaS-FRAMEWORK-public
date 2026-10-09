/**
 * Stylist card helpers — deterministic hue palette per display name.
 *
 * Public list endpoint exposes no cover image, no portfolio samples.
 * We generate gradient covers/thumb tiles from a name hash so each
 * stylist has a stable, distinct palette. Swap to <Image> if/when the
 * DTO gains cover_image_url or sample_photos.
 */

export interface HuePreset {
  readonly primary: string;
  readonly accent: string;
}

const DEFAULT_HUE: HuePreset = {
  primary: 'oklch(0.82 0.16 25)',
  accent: 'oklch(0.85 0.14 340)',
};

const HUE_PRESETS: readonly HuePreset[] = [
  DEFAULT_HUE, // rose / pink
  { primary: 'oklch(0.78 0.15 85)', accent: 'oklch(0.82 0.13 50)' }, // amber / gold
  { primary: 'oklch(0.74 0.14 200)', accent: 'oklch(0.78 0.12 240)' }, // teal / blue
  { primary: 'oklch(0.77 0.16 310)', accent: 'oklch(0.81 0.14 280)' }, // violet / lilac
  { primary: 'oklch(0.79 0.15 140)', accent: 'oklch(0.83 0.13 110)' }, // sage / mint
  { primary: 'oklch(0.81 0.12 30)', accent: 'oklch(0.78 0.14 0)' }, // peach / coral
];

function hashName(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export function getCoverHues(name: string): HuePreset {
  const idx = hashName(name) % HUE_PRESETS.length;
  return HUE_PRESETS[idx] ?? DEFAULT_HUE;
}

export function getThumbHue(seed: string, index: number): string {
  const idx = (hashName(seed) + index * 17) % HUE_PRESETS.length;
  return HUE_PRESETS[idx]?.primary ?? DEFAULT_HUE.primary;
}
