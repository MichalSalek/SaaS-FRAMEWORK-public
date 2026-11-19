import { legacyVariableName } from './color-space.ts';

export const MODERN_COLOR_SUPPORT =
  '(color: oklch(0% 0 0)) and (color: color-mix(in oklch, white, black))';

export function resolverVariableName(name: string): string {
  legacyVariableName(name);
  return `--nf-r-${name.slice(2)}`;
}

export function modernVariableName(name: string): string {
  legacyVariableName(name);
  return `${name}-nf-modern`;
}

/** Inline producers share this registry with the build-time CSS resolver. */
export const RUNTIME_COLOR_VARIABLES = [
  '--polish-fill',
  '--polish-mark',
  '--style-hue',
  '--chip-hue',
  '--brand-accent',
  '--statusColor',
  '--chip-bg',
  '--chip-border',
  '--chip-text',
  '--share-color',
] as const;

export const INLINE_COLOR_PROPERTIES = [
  'background',
  'backgroundColor',
  'backgroundImage',
  'color',
  'border',
  'borderColor',
  'borderTop',
  'borderTopColor',
  'borderRight',
  'borderRightColor',
  'borderBottom',
  'borderBottomColor',
  'borderLeft',
  'borderLeftColor',
  'outline',
  'outlineColor',
  'fill',
  'stroke',
  'boxShadow',
  'textShadow',
  'filter',
  'columnRule',
  'columnRuleColor',
  'textDecoration',
  'textDecorationColor',
  'textEmphasisColor',
  'caretColor',
  'accentColor',
] as const;

export const INLINE_COLOR_VARIABLES = Object.fromEntries(
  INLINE_COLOR_PROPERTIES.map(property => [
    property,
    `--nf-inline-${property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`,
  ])
) as Record<(typeof INLINE_COLOR_PROPERTIES)[number], string>;

export const RUNTIME_PAINT_VARIABLES = Object.values(INLINE_COLOR_VARIABLES);
export const ALL_RUNTIME_COLOR_VARIABLES = [
  ...RUNTIME_COLOR_VARIABLES,
  ...RUNTIME_PAINT_VARIABLES,
] as const;
