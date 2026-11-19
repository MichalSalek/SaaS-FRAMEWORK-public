import { describe, expect, it } from 'vitest';
import { getColorDisplay } from './ColorDot.config';
import {
  oklchToSrgb,
  parseOklch,
  relativeLuminance,
} from '../../../application/colors/color-space';
describe('display palette compatibility', () => {
  it('keeps taxonomy values separate and chooses an AA mark for every display fill', () => {
    for (const color of [
      '#ffffff',
      '#000000',
      '#808080',
      '#ff0000',
      '#ffa500',
      '#ffff00',
      '#008000',
      '#40e0d0',
      '#007bff',
      '#800080',
      '#ff69b4',
      '#f5f5dc',
      '#8b4513',
      '#d4af37',
    ]) {
      const display = getColorDisplay(color);
      const parsed = parseOklch(display.fill);
      expect(parsed).not.toBeNull();
      if (parsed === null) {
        throw new Error('Invalid display color');
      }
      const luminance = relativeLuminance(oklchToSrgb(parsed));
      const contrast =
        display.mark === 'oklch(0 0 0)'
          ? (luminance + 0.05) / 0.05
          : 1.05 / (luminance + 0.05);
      expect(contrast).toBeGreaterThanOrEqual(4.5);
      expect(display.markContrast).toBeCloseTo(contrast, 10);
      expect(display.metallic).toBe(color === '#d4af37');
    }
    expect(getColorDisplay('rebeccapurple').fill).toBe('rebeccapurple');
  });
});
