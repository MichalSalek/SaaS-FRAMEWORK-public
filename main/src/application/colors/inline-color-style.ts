import type { CSSProperties } from 'react';
import { transformCssColorValue } from './css-color-expression.ts';
import { variableChannels } from './color-space.ts';
import { conditionalVariableStyle } from './color-css-variables.ts';
import { INLINE_COLOR_VARIABLES } from './runtime-color-variables.ts';

/** Paired custom properties keep modern inline gradients out of the legacy value path. */
export function inlineColorStyle(style: CSSProperties): CSSProperties {
  const result: CSSProperties = { ...style };
  for (const property of Object.keys(INLINE_COLOR_VARIABLES) as Array<
    keyof typeof INLINE_COLOR_VARIABLES
  >) {
    const value = style[property];
    if (
      typeof value !== 'string' ||
      !/(?:color-mix|oklch|oklab|lab|lch|color)\s*\(|(?:rgba?|hsla?)\(\s*from\b/i.test(
        value
      )
    ) {
      continue;
    }
    const transformed = transformCssColorValue(value, {
      resolveVariable: variableChannels,
    });
    if (!transformed.changed) {
      continue;
    }
    const name = INLINE_COLOR_VARIABLES[property];
    Object.assign(
      result,
      conditionalVariableStyle(name, value, transformed.legacy)
    );
    result[property] = `var(${name})`;
  }
  return result;
}
