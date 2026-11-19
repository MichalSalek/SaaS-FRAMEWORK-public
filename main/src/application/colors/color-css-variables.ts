import type { CSSProperties } from 'react';
import { transformCssColorValue } from './css-color-expression.ts';
import {
  channelVariableName,
  legacyVariableName,
  variableChannels,
  type ColorChannels,
} from './color-space.ts';
import {
  ALL_RUNTIME_COLOR_VARIABLES,
  modernVariableName,
  resolverVariableName,
} from './runtime-color-variables.ts';

const registered = new Set<string>(ALL_RUNTIME_COLOR_VARIABLES);

/** Browser feature selection stays in CSS, so SSR and hydration emit identical props. */
export function conditionalVariableStyle(
  name: string,
  original: string,
  legacy: string,
  channels?: ColorChannels
): CSSProperties {
  if (!registered.has(name)) {
    throw new Error(`Unregistered inline color variable: ${name}`);
  }
  const style: Record<string, string> = {};
  style[name] =
    legacy === original
      ? original
      : `var(${resolverVariableName(name)}, ${original})`;
  if (legacy !== original) {
    style[legacyVariableName(name)] = legacy;
    style[modernVariableName(name)] = original;
  }
  if (channels) {
    for (const key of ['r', 'g', 'b', 'a'] as const) {
      style[channelVariableName(name, key)] = channels[key];
    }
  }
  return style as CSSProperties;
}

/** Unknown dynamic CSS is preserved, never replaced with a guessed color. */
export function colorVariableStyle(name: string, value: string): CSSProperties {
  try {
    const transformed = transformCssColorValue(value, {
      resolveVariable: variableChannels,
      colorChannels: true,
    });
    return conditionalVariableStyle(
      name,
      value,
      transformed.legacy,
      transformed.channels
    );
  } catch {
    // Public component color props accept legacy CSS forms beyond the display palette.
    // Preserve those inputs; the build guard remains strict for authored CSS expressions.
    return conditionalVariableStyle(name, value, value);
  }
}
