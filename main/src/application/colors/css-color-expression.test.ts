import { describe, expect, it, vi } from 'vitest';
import {
  colorFromChannels,
  literalChannels,
  mixChannelExpressions,
  oklchToSrgb,
  parseOklch,
  variableChannels,
} from './color-space';
import { transformCssColorValue } from './css-color-expression';

const resolveVariable = vi.fn(
  (name: string, fallback?: ReturnType<typeof literalChannels>) =>
    variableChannels(name, fallback)
);
const options = { resolveVariable };

function literal(input: string) {
  const parsed = parseOklch(input);
  if (!parsed) {
    throw new Error('invalid test color');
  }
  return literalChannels(oklchToSrgb(parsed));
}

describe('CSS color expressions', () => {
  it('rewrites literal OKLCH without changing alpha and exposes whole-color channels', () => {
    const value = 'oklch(60% 0.16 1turn / 40%)';
    const channels = literal(value);
    expect(
      transformCssColorValue(value, { ...options, colorChannels: true })
    ).toEqual({
      legacy: colorFromChannels(channels),
      changed: true,
      channels,
    });
  });

  it('preserves structure, quotes, comments and normal variables while rewriting nested values', () => {
    resolveVariable.mockClear();
    const value =
      'linear-gradient(30deg, /* keep */ oklch(.7 .1 10), var(--background, oklch(.6 .1 20))), "oklch(.1 .2 3)"';
    const result = transformCssColorValue(value, options);
    expect(result.changed).toBe(true);
    expect(result.legacy).toBe(
      `linear-gradient(30deg, /* keep */ ${colorFromChannels(literal('oklch(.7 .1 10)'))}, var(--background, ${colorFromChannels(literal('oklch(.6 .1 20)'))})), "oklch(.1 .2 3)"`
    );
    expect(resolveVariable).not.toHaveBeenCalled();
  });

  it('does not resolve unrelated variables without a color context', () => {
    resolveVariable.mockClear();
    const value = 'var(--font, "hello") var(--spacing, 2rem)';
    expect(transformCssColorValue(value, options)).toEqual({
      legacy: value,
      changed: false,
    });
    expect(resolveVariable).not.toHaveBeenCalled();
    expect(
      transformCssColorValue('var(--primary)', {
        ...options,
        colorChannels: true,
      })
    ).toEqual({
      legacy: colorFromChannels(variableChannels('--primary')),
      changed: true,
      channels: variableChannels('--primary'),
    });
  });

  it('uses color fallbacks and premultiplied channels for nested mixes', () => {
    resolveVariable.mockClear();
    const fallback = literal('oklch(.6 .1 20 / .5)');
    const left = variableChannels('--primary', fallback);
    const inner = mixChannelExpressions(
      literalChannels([255, 255, 255, 0.5]),
      literalChannels([0, 0, 0, 0]),
      0.5,
      0.5
    );
    const mixed = mixChannelExpressions(left, inner, 0.3, 0.7);
    const value =
      'color-mix(in oklch, var(--primary, oklch(.6 .1 20 / .5)) 30%, color-mix(in srgb, rgb(255 255 255 / .5), transparent))';
    expect(
      transformCssColorValue(value, { ...options, colorChannels: true })
    ).toEqual({
      legacy: colorFromChannels(mixed),
      changed: true,
      channels: mixed,
    });
    expect(resolveVariable).toHaveBeenCalledWith('--primary', fallback);
  });

  it.each([
    ['black, white', 0.5, 0.5, 1],
    ['black 20%, white', 0.2, 0.8, 1],
    ['black, white 20%', 0.8, 0.2, 1],
    ['black 20%, white 30%', 0.4, 0.6, 0.5],
    ['black 70%, white 70%', 0.5, 0.5, 1],
    ['black 0%, white 100%', 0, 1, 1],
  ])('normalizes %s', (stops, leftWeight, rightWeight, alphaMultiplier) => {
    const expected = mixChannelExpressions(
      literalChannels([0, 0, 0, 1]),
      literalChannels([255, 255, 255, 1]),
      leftWeight,
      rightWeight,
      alphaMultiplier
    );
    expect(
      transformCssColorValue(`color-mix(in srgb, ${stops})`, {
        ...options,
        colorChannels: true,
      })
    ).toEqual({
      legacy: colorFromChannels(expected),
      changed: true,
      channels: expected,
    });
  });

  it('returns channels for already-supported whole literals without claiming a rewrite', () => {
    expect(
      transformCssColorValue('#ff008080', { ...options, colorChannels: true })
    ).toEqual({
      legacy: '#ff008080',
      changed: false,
      channels: literalChannels([255, 0, 128, 128 / 255]),
    });
  });

  it.each([
    'oklch(from red l c h)',
    'oklch(.5 .1 30',
    'color-mix(in srgb, currentColor 20%, black)',
    'color-mix(in lab, black, white)',
    'color-mix(in oklch longer hue, black, white)',
    'color-mix(in srgb, black var(--weight), white)',
    'color-mix(in srgb, black 0%, white 0%)',
    'color-mix(in srgb, black 120%, white)',
    'color-mix(in srgb, black -2%, white)',
    'color-mix(in srgb, no-such-color, white)',
    'color-mix(in srgb, var(--foo, 2rem), white)',
    'color-mix(in srgb, black, white',
  ])('rejects unsupported or invalid expression: %s', value => {
    expect(() => transformCssColorValue(value, options)).toThrow();
  });
});

describe('comments and unsupported colors', () => {
  it('retains comments inside a rewritten color expression', () => {
    const value =
      'color-mix(in srgb, /*first*/ var(--x, /*fallback*/ #fff), transparent /*last*/)';
    const result = transformCssColorValue(value, options);
    expect(result.legacy).toContain('/*first*/');
    expect(result.legacy).toContain('/*fallback*/');
    expect(result.legacy).toContain('/*last*/');
  });
  it.each([
    'oklab(.5 .2 .1)',
    'color(display-p3 1 0 0)',
    'rgb(from red r g b)',
  ])('rejects unhandled modern syntax %s', value => {
    expect(() => transformCssColorValue(value, options)).toThrow();
  });
});

describe('literal colors and syntax boundaries', () => {
  it('keeps comments while parsing a literal OKLCH color', () => {
    const result = transformCssColorValue(
      'oklch(/*L*/ .6 /*C*/ .1 20 / 50%)',
      options
    );
    expect(result.legacy).toContain('/*L*//*C*/');
    expect(result.legacy).toContain(
      colorFromChannels(literal('oklch(.6 .1 20 / 50%)'))
    );
  });
  it('parses percent rgb channels and hexadecimal alpha using the shared conversion', () => {
    const expected = mixChannelExpressions(
      literalChannels([127.5, 0, 0, 0.5]),
      literalChannels([255, 255, 255, 128 / 255]),
      0.5,
      0.5
    );
    expect(
      transformCssColorValue(
        'color-mix(in srgb, rgb(50% 0% 0% / 50%), #ffffff80)',
        { ...options, colorChannels: true }
      ).channels
    ).toEqual(expected);
  });
  it('keeps supported unrelated functions and ignores color-looking quoted text', () => {
    const value =
      'url("/oklch(1 0 0).svg") format("color-mix(in srgb, black, white)")';
    expect(transformCssColorValue(value, options)).toEqual({
      legacy: value,
      changed: false,
    });
  });
  it.each([
    'color-mix(in srgb, black,)',
    'color-mix(in srgb, black 10% 20%, white)',
    'color-mix(in srgb, black, white, black)',
    'color-mix(in srgb, var(--x, currentColor), white)',
    'color-mix(in srgb, var(--x,), white)',
    'color-mix(in srgb-linear, black, white)',
  ])('rejects malformed or unresolved endpoints %s', value => {
    expect(() => transformCssColorValue(value, options)).toThrow();
  });
});
