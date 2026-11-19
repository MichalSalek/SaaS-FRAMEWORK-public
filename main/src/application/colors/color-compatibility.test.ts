import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { colorVariableStyle } from './color-css-variables';
import { inlineColorStyle } from './inline-color-style';
import { parseColorLiteral } from './color-space';

describe('legacy color integration', () => {
  it('preserves the approved raspberry as exact sRGB within rounding precision', () => {
    const color = parseColorLiteral('oklch(0.469533 0.185479 3.79231)');
    expect(color?.slice(0, 3).map(Math.round)).toEqual([166, 7, 79]);
  });

  it('keeps SSR deterministic with CSS selecting the browser capability', () => {
    const style = colorVariableStyle('--polish-fill', 'oklch(0.65 0.115 80)');
    const html = renderToString(createElement('span', { style }));
    expect(html).toContain(
      '--polish-fill:var(--nf-r-polish-fill, oklch(0.65 0.115 80))'
    );
    expect(html).toContain('--polish-fill-nf-modern:oklch(0.65 0.115 80)');
    expect(html).toContain('--polish-fill-nf-legacy:rgba(');
    expect(html).toContain('--nf-c-polish-fill-r:');
    expect(
      renderToString(
        createElement('span', {
          style: colorVariableStyle('--polish-fill', 'oklch(0.65 0.115 80)'),
        })
      )
    ).toBe(html);
  });

  it('publishes scoped channels for symbolic runtime inputs and retains unknown legacy inputs', () => {
    expect(
      colorVariableStyle('--statusColor', 'var(--color-success)')
    ).toMatchObject({
      '--nf-c-statusColor-r': 'var(--nf-c-color-success-r)',
    });
    expect(colorVariableStyle('--polish-fill', 'rebeccapurple')).toMatchObject({
      '--polish-fill': 'rebeccapurple',
      '--nf-c-polish-fill-r': '102',
      '--nf-c-polish-fill-g': '51',
      '--nf-c-polish-fill-b': '153',
    });
  });

  it('gates complete inline gradients and is safe to call twice', () => {
    const style = {
      background:
        'conic-gradient(color-mix(in oklch, var(--color-primary), black) 0deg 90deg, var(--color-bg-paper) 90deg)',
    };
    const result = inlineColorStyle(style);
    expect(result.background).toBe('var(--nf-inline-background)');
    expect(result).toHaveProperty(
      '--nf-inline-background-nf-modern',
      style.background
    );
    expect(
      result['--nf-inline-background-nf-legacy' as keyof typeof result]
    ).not.toMatch(/color-mix|oklch/);
    expect(inlineColorStyle(result)).toEqual(result);
    expect(inlineColorStyle({ background: 'hwb(0 0% 0%)', width: 15 })).toEqual(
      { background: 'hwb(0 0% 0%)', width: 15 }
    );
  });
});
