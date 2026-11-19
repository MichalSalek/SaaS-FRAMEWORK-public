import namedColors from 'color-name';
import { parseCylindricalColor } from './color-literal-cylindrical.ts';

export type Rgba = readonly [number, number, number, number];
export type Oklcha = readonly [number, number, number, number];
export type ColorChannels = Readonly<{
  r: string;
  g: string;
  b: string;
  a: string;
}>;

const clamp = (value: number, maximum = 1): number =>
  Math.max(0, Math.min(maximum, value));
const NUMBER = '[+-]?(?:\\d*\\.\\d+|\\d+\\.?\\d*)(?:e[+-]?\\d+)?';
const OKLCH = new RegExp(
  `^oklch\\(\\s*(${NUMBER}%?)\\s+(${NUMBER}%?)\\s+(${NUMBER}(?:deg|rad|grad|turn)?)(?:\\s*/\\s*(${NUMBER}%?))?\\s*\\)$`,
  'i'
);

const amount = (value: string, percentScale = 0.01): number =>
  value.endsWith('%') ? Number.parseFloat(value) * percentScale : Number(value);

/** CSS Color 4 uses 0.4 as the 100% chroma reference for OKLCH. */
export function parseOklch(value: string): Oklcha | null {
  const match = OKLCH.exec(value.trim());
  if (!match) {
    return null;
  }
  const hueText = match[3] ?? '';
  const number = Number.parseFloat(hueText);
  const hue = /turn$/i.test(hueText)
    ? number * 360
    : /grad$/i.test(hueText)
      ? number * 0.9
      : /rad$/i.test(hueText)
        ? (number * 180) / Math.PI
        : number;
  return [
    clamp(amount(match[1] ?? '0')),
    Math.max(0, amount(match[2] ?? '0', 0.004)),
    hue,
    match[4] ? clamp(amount(match[4])) : 1,
  ];
}

const encodeSrgb = (value: number): number => {
  const linear = clamp(value);
  return (
    255 *
    (linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055)
  );
};

const decodeSrgb = (value: number): number => {
  const encoded = clamp(value, 255) / 255;
  return encoded <= 0.04045
    ? encoded / 12.92
    : ((encoded + 0.055) / 1.055) ** 2.4;
};

/** One conversion for build fallbacks, inline paint and rendered contrast. */
export function oklchToSrgb([lightness, chroma, hue, alpha]: Oklcha): Rgba {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    encodeSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    encodeSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    encodeSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    clamp(alpha),
  ];
}

export function parseColorLiteral(value: string): Rgba | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'transparent') {
    return [0, 0, 0, 0];
  }
  if (normalized === 'white' || normalized === 'black') {
    const channel = normalized === 'white' ? 255 : 0;
    return [channel, channel, channel, 1];
  }
  if (Object.hasOwn(namedColors, normalized)) {
    const color = namedColors[normalized];
    if (color !== undefined) {
      return [color[0], color[1], color[2], 1];
    }
  }
  const lch = parseOklch(normalized);
  if (lch) {
    return oklchToSrgb(lch);
  }
  if (/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/.test(normalized)) {
    const raw = normalized.slice(1);
    const hex =
      raw.length < 5 ? [...raw].map(char => char + char).join('') : raw;
    const channel = (offset: number): number =>
      Number.parseInt(hex.slice(offset, offset + 2), 16);
    return [
      channel(0),
      channel(2),
      channel(4),
      hex.length === 8 ? channel(6) / 255 : 1,
    ];
  }
  const rgb = /^rgba?\(([^)]+)\)$/.exec(normalized);
  if (rgb) {
    const parts = (rgb[1] ?? '').trim().split(/\s*[,/]\s*|\s+/);
    if (
      (parts.length === 3 || parts.length === 4) &&
      parts.every(part => new RegExp(`^${NUMBER}%?$`, 'i').test(part))
    ) {
      return [
        clamp(amount(parts[0] ?? '0', 2.55), 255),
        clamp(amount(parts[1] ?? '0', 2.55), 255),
        clamp(amount(parts[2] ?? '0', 2.55), 255),
        parts[3] ? clamp(amount(parts[3])) : 1,
      ];
    }
  }
  return parseCylindricalColor(normalized);
}

export function cssNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error('A CSS color channel must be finite');
  }
  return String(Number(value.toPrecision(12)));
}

export function literalChannels([r, g, b, a]: Rgba): ColorChannels {
  return { r: cssNumber(r), g: cssNumber(g), b: cssNumber(b), a: cssNumber(a) };
}

export function colorFromChannels(channels: ColorChannels): string {
  return `rgba(${channels.r}, ${channels.g}, ${channels.b}, ${channels.a})`;
}

export function legacyVariableName(name: string): string {
  if (!/^--[\w-]+$/.test(name)) {
    throw new Error(`Invalid CSS color variable: ${name}`);
  }
  return `${name}-nf-legacy`;
}

export function channelVariableName(
  name: string,
  channel: keyof ColorChannels
): string {
  legacyVariableName(name);
  return `--nf-c-${name.slice(2)}-${channel}`;
}

export function variableChannels(
  name: string,
  fallback?: ColorChannels
): ColorChannels {
  const read = (key: keyof ColorChannels): string =>
    `var(${channelVariableName(name, key)}${fallback ? `, ${fallback[key]}` : ''})`;
  return { r: read('r'), g: read('g'), b: read('b'), a: read('a') };
}

/** Premultiplied sRGB approximation for the legacy branch only. */
export function mixChannelExpressions(
  left: ColorChannels,
  right: ColorChannels,
  leftWeight: number,
  rightWeight: number,
  alphaMultiplier = 1
): ColorChannels {
  if (
    ![leftWeight, rightWeight, alphaMultiplier].every(Number.isFinite) ||
    leftWeight < 0 ||
    rightWeight < 0 ||
    leftWeight + rightWeight <= 0 ||
    alphaMultiplier < 0 ||
    alphaMultiplier > 1
  ) {
    throw new Error('Invalid CSS color mix weights');
  }
  const p = cssNumber(leftWeight);
  const q = cssNumber(rightWeight);
  const alpha = `(${left.a} * ${p} + ${right.a} * ${q})`;
  if (right.a === '0') {
    return {
      ...left,
      a: `calc(${left.a} * ${p} * ${cssNumber(alphaMultiplier)})`,
    };
  }
  if (left.a === '0') {
    return {
      ...right,
      a: `calc(${right.a} * ${q} * ${cssNumber(alphaMultiplier)})`,
    };
  }
  const blend = (key: 'r' | 'g' | 'b'): string =>
    `calc((${left[key]} * ${left.a} * ${p} + ${right[key]} * ${right.a} * ${q}) / max(0.0000001, ${alpha}))`;
  return {
    r: blend('r'),
    g: blend('g'),
    b: blend('b'),
    a: `calc(${alpha} * ${cssNumber(alphaMultiplier)})`,
  };
}

export function relativeLuminance([r, g, b]: Rgba): number {
  return (
    0.2126 * decodeSrgb(r) + 0.7152 * decodeSrgb(g) + 0.0722 * decodeSrgb(b)
  );
}
