/**
 * Colour theme of the stylist OG card (BRANDING_VALUE_LADDER step 6).
 *
 * CSS variables are not available in a Node.js API route, so the card works
 * with literal hex values. Two themes:
 * - BRAND: the Nailfolio default (rouge-papier dark roles), used when the
 *   stylist has no accent or her plan does not include branding (the backend
 *   masks `brand_accent_color` to null by plan, so no plan check lives here).
 * - accent: the stylist's own colour fills the card and the text takes ink or
 *   white, whichever contrasts more with that colour.
 */

// Hex equivalents of the fuchsia dark primary/accent-fg roles.
// Source of truth: main/src/UI/styles/themes/palettes.css (rouge-papier dark).
// Dark background chosen so the card has premium look on all social platforms.
export const BRAND = {
  bgMain: '#0f0d0a',
  bgCard: '#1c1a18',
  accent: '#fc7bb9',
  accentText: '#ff98c7',
  textPrimary: '#efece8',
  textSecondary: '#c0bdb9',
  border: '#6e6b68',
} as const;

export type OgTheme = {
  bgMain: string;
  bgCard: string;
  accent: string;
  accentText: string;
  textPrimary: string;
  textSecondary: string;
  // The Nailfolio egg mark is magenta: on a stylist's colour field it clashes
  // with her brand, so a branded card keeps only the wordmark.
  showLogoMark: boolean;
};

export const DEFAULT_OG_THEME: OgTheme = {
  bgMain: BRAND.bgMain,
  bgCard: BRAND.bgCard,
  accent: BRAND.accent,
  accentText: BRAND.accentText,
  textPrimary: BRAND.textPrimary,
  textSecondary: BRAND.textSecondary,
  showLogoMark: true,
};

// Ink = light-theme --color-text-primary (oklch 0.215 0.006 80) in sRGB.
const INK = '#1c1a18';
const WHITE = '#ffffff';
// Secondary text keeps the same hue at reduced strength; the unit test holds
// it at AA (4.5:1) against every colour of the kernel palette.
export const OG_SECONDARY_ALPHA = 0.82;
const AVATAR_FILL_ALPHA = 0.16;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

type Rgb = { r: number; g: number; b: number };

export function parseHex(hex: string): Rgb {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function channelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance({ r, g, b }: Rgb): number {
  return (
    0.2126 * channelToLinear(r) +
    0.7152 * channelToLinear(g) +
    0.0722 * channelToLinear(b)
  );
}

/** WCAG 2 contrast ratio of two opaque colours. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Opaque result of `fg` at `alpha` over `bg` (what the reader sees). */
export function blendOver(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return {
    r: Math.round(fg.r * alpha + bg.r * (1 - alpha)),
    g: Math.round(fg.g * alpha + bg.g * (1 - alpha)),
    b: Math.round(fg.b * alpha + bg.b * (1 - alpha)),
  };
}

function toRgba({ r, g, b }: Rgb, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Ink or white, whichever reads better on `background`. */
export function pickTextOn(background: string): string {
  const bg = parseHex(background);
  return contrastRatio(parseHex(WHITE), bg) >= contrastRatio(parseHex(INK), bg)
    ? WHITE
    : INK;
}

/** Theme for the card: the stylist's accent when it is a valid hex, else BRAND. */
export function resolveOgTheme(accent: string | null | undefined): OgTheme {
  // DECISION: only a strict #RRGGBB reaches satori. The write path limits the column to the
  // kernel palette, but this card reads fetched JSON, so a malformed value falls back to
  // BRAND instead of a broken style or a failed render.
  if (typeof accent !== 'string' || !HEX_RE.test(accent)) {
    return DEFAULT_OG_THEME;
  }
  const text = pickTextOn(accent);
  const textRgb = parseHex(text);
  return {
    bgMain: accent,
    bgCard: toRgba(textRgb, AVATAR_FILL_ALPHA),
    accent: text,
    accentText: text,
    textPrimary: text,
    textSecondary: toRgba(textRgb, OG_SECONDARY_ALPHA),
    showLogoMark: false,
  };
}
