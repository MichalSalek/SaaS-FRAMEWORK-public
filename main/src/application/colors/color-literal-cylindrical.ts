import type { Rgba } from './color-space.ts';

const NUMBER = '[+-]?(?:\\d*\\.\\d+|\\d+\\.?\\d*)(?:e[+-]?\\d+)?';
const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const fraction = (value: string): number =>
  clamp(Number.parseFloat(value) / (value.endsWith('%') ? 100 : 1));

/** Legacy HSL/HWB literals accepted by public color props, without browser-only parsing. */
export function parseCylindricalColor(value: string): Rgba | null {
  const match = /^(hsla?|hwb)\(([^)]+)\)$/.exec(value);
  if (!match) {
    return null;
  }
  const parts = (match[2] ?? '').trim().split(/\s*[,/]\s*|\s+/);
  if (
    (parts.length !== 3 && parts.length !== 4) ||
    !new RegExp(`^${NUMBER}(?:deg|rad|grad|turn)?$`, 'i').test(
      parts[0] ?? ''
    ) ||
    !parts
      .slice(1, 3)
      .every(part => new RegExp(`^${NUMBER}%$`, 'i').test(part)) ||
    (parts[3] !== undefined && !new RegExp(`^${NUMBER}%?$`, 'i').test(parts[3]))
  ) {
    return null;
  }
  const text = parts[0] ?? '0';
  const rawHue = Number.parseFloat(text);
  const degrees = /turn$/.test(text)
    ? rawHue * 360
    : /grad$/.test(text)
      ? rawHue * 0.9
      : /rad$/.test(text)
        ? (rawHue * 180) / Math.PI
        : rawHue;
  const h = ((degrees % 360) + 360) % 360;
  const first = fraction(parts[1] ?? '0');
  const second = fraction(parts[2] ?? '0');
  const alpha = parts[3] ? fraction(parts[3]) : 1;
  const hueChannel = (offset: number): number => {
    const k = (offset + h / 30) % 12;
    return 1 - Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  if (match[1] === 'hwb') {
    if (first + second >= 1) {
      const gray = (255 * first) / (first + second);
      return [gray, gray, gray, alpha];
    }
    const channel = (offset: number): number =>
      255 * ((hueChannel(offset) / 2) * (1 - first - second) + first);
    return [channel(0), channel(8), channel(4), alpha];
  }
  const amplitude = first * Math.min(second, 1 - second);
  const channel = (offset: number): number =>
    255 * (second + amplitude * (hueChannel(offset) - 1));
  return [channel(0), channel(8), channel(4), alpha];
}
