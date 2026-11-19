import { describe, it, expect } from 'vitest';
import { BRAND_ACCENT_HEXES } from '@kernel/domain/user-and-account/branding.config';
import {
  DEFAULT_OG_THEME,
  OG_SECONDARY_ALPHA,
  blendOver,
  contrastRatio,
  parseHex,
  pickTextOn,
  resolveOgTheme,
} from './ogCard.theme';

describe('resolveOgTheme', () => {
  it('falls back to the Nailfolio theme without an accent', () => {
    expect(resolveOgTheme(null)).toBe(DEFAULT_OG_THEME);
    expect(resolveOgTheme(undefined)).toBe(DEFAULT_OG_THEME);
  });

  it('falls back to the Nailfolio theme for a malformed value', () => {
    for (const bad of ['', '#fff', 'red', '#12345G', '#123456;x', 'url(x)']) {
      expect(resolveOgTheme(bad)).toBe(DEFAULT_OG_THEME);
    }
  });

  it('fills the card with the accent and drops the magenta mark', () => {
    const theme = resolveOgTheme('#8C2F45');
    expect(theme.bgMain).toBe('#8C2F45');
    expect(theme.showLogoMark).toBe(false);
    expect(theme.textPrimary).toBe('#ffffff');
  });

  it('takes ink on a light accent', () => {
    expect(pickTextOn('#F2E6C8')).toBe('#1c1a18');
  });

  it('keeps primary and secondary text at AA on every palette colour', () => {
    for (const hex of BRAND_ACCENT_HEXES) {
      const bg = parseHex(hex);
      const text = parseHex(pickTextOn(hex));
      expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
      const secondary = blendOver(text, bg, OG_SECONDARY_ALPHA);
      expect(contrastRatio(secondary, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
