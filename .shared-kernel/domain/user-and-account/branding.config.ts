/**
 * Branding-light of the public profile: an accent colour from a CURATED palette, not a free picker.
 * The colour TAKES OVER the accent of the stylist's public page, salon and gallery (primary button,
 * arrow discs, icons) through brandScopeProps in the front. The palette of dark tones gives light
 * text on the colour AA in light mode (in dark mode the front takes a lighter tone of the same hue);
 * validating "colour in palette" settles this without computing contrast at runtime and blocks
 * style injection (only a list value reaches the DB).
 * SSOT for the validator (kernel), the account picker and the profile render.
 */
export const BRAND_ACCENT_PALETTE = Object.freeze([
  { id: 'rosewood', hex: '#8C2F45' }, // deep rose-burgundy (beauty classic)
  { id: 'terracotta', hex: '#A34A28' }, // warm terracotta
  { id: 'espresso', hex: '#5B4030' }, // coffee brown
  { id: 'olive', hex: '#556B2F' }, // olive
  { id: 'forest', hex: '#1F5F3F' }, // bottle green
  { id: 'teal', hex: '#0F6B6B' }, // sea teal
  { id: 'indigo', hex: '#3B3E8F' }, // indigo
  { id: 'plum', hex: '#6B2D5C' }, // plum
  { id: 'graphite', hex: '#3A3F45' }, // graphite (minimal)
  { id: 'crimson', hex: '#9E1B32' }, // crimson
] as const);

export const BRAND_ACCENT_HEXES: readonly string[] = Object.freeze(
  BRAND_ACCENT_PALETTE.map(c => c.hex)
);

export const isBrandAccentHex = (value: string): boolean =>
  BRAND_ACCENT_HEXES.includes(value);
