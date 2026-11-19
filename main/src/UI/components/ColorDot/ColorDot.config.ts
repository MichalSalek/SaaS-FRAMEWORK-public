import {
  oklchToSrgb,
  parseColorLiteral,
  relativeLuminance,
} from '../../../application/colors/color-space';

// DECISION: this display map is the SSOT for Nailfolio colour discs, including public profiles
// and gallery cards. Seed hex values remain the stable taxonomy/DB values; structured data and
// e-mails keep those canonical values, not screen paint. Never migrate saved colours to this
// palette. Unknown admin colours keep their supplied fill. Gold alone keeps the winning shelf's
// metallic treatment. (owner)
const DISPLAY_COLORS: Readonly<
  Partial<Record<string, readonly [number, number, number]>>
> = {
  '#ffffff': [0.94, 0.015, 80],
  '#000000': [0.2, 0.015, 285],
  '#808080': [0.5, 0.025, 270],
  '#ff0000': [0.48, 0.175, 25],
  '#ffa500': [0.59, 0.145, 43],
  '#ffff00': [0.77, 0.14, 90],
  '#008000': [0.45, 0.075, 135],
  '#40e0d0': [0.57, 0.085, 190],
  '#007bff': [0.35, 0.08, 260],
  '#800080': [0.43, 0.115, 315],
  '#ff69b4': [0.66, 0.12, 355],
  '#f5f5dc': [0.76, 0.055, 65],
  '#8b4513': [0.31, 0.05, 45],
  '#d4af37': [0.65, 0.115, 80],
};

export function getColorDisplay(color: string) {
  const key = color.toLowerCase();
  const value = DISPLAY_COLORS[key];
  const customHex = /^#?[a-f\d]{3}(?:[a-f\d]{3})?$/i.test(color)
    ? parseColorLiteral(`#${color.replace(/^#/, '')}`)
    : null;
  const background =
    value !== undefined
      ? relativeLuminance(oklchToSrgb([...value, 1]))
      : customHex !== null
        ? relativeLuminance(customHex)
        : 0.5;
  const blackContrast = (background + 0.05) / 0.05;
  const whiteContrast = 1.05 / (background + 0.05);
  return {
    fill:
      value !== undefined
        ? `oklch(${value[0]} ${value[1]} ${value[2]})`
        : color,
    mark: blackContrast >= whiteContrast ? 'oklch(0 0 0)' : 'oklch(1 0 0)',
    markContrast: Math.max(blackContrast, whiteContrast),
    metallic: key === '#d4af37',
  };
}
