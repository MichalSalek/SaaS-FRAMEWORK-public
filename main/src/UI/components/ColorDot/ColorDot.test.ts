import { describe, expect, it } from 'vitest';
import { COLOR_SEED_DATA } from '@kernel/domain/gallery/gallery.seed';
import { getColorDisplay } from './ColorDot.config';

describe('production display palette', () => {
  it('covers every seed with OKLCH and a legible selected mark', () => {
    for (const color of COLOR_SEED_DATA) {
      const display = getColorDisplay(color.hex_code);
      expect(display.fill).toMatch(/^oklch/);
      expect(display.markContrast).toBeGreaterThanOrEqual(4.5);
      expect(getColorDisplay(color.hex_code.toUpperCase())).toEqual(display);
    }
  });
  it('preserves custom colour fills and computes their mark contrast', () => {
    expect(getColorDisplay('#abcdef').fill).toBe('#abcdef');
    expect(getColorDisplay('#fff').mark).toBe('oklch(0 0 0)');
    expect(getColorDisplay('#000').mark).toBe('oklch(1 0 0)');
  });
  it('pins the owner palette and limits the metallic finish to gold', () => {
    expect(getColorDisplay('#ff0000').fill).toBe('oklch(0.48 0.175 25)');
    expect(
      COLOR_SEED_DATA.filter(c => getColorDisplay(c.hex_code).metallic).map(
        c => c.name
      )
    ).toEqual(['Złote']);
  });
});
