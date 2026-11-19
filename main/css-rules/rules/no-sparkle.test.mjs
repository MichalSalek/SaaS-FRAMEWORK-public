// @vitest-environment node
import { describe, expect, it } from 'vitest';
import rule from './no-sparkle.mjs';
import { lintCss } from '../test-utils.mjs';

const lint = css =>
  lintCss(rule, { 'src/UI/features/fixture/a.module.css': css }).findings;

describe('css/no-sparkle', () => {
  it('rejects a star path and the star emoji', () => {
    expect(
      lint(
        '.mark { background: url("data:image/svg+xml,M40 8 L43 36 L72 40"); }'
      )
    ).toHaveLength(1);
    expect(lint(".mark { content: '⭐'; }")).toHaveLength(1);
    expect(lint('.mark { d: path("L72 18 L78 20"); }')).toHaveLength(1);
  });

  it('accepts a comment and a circle tile', () => {
    expect(
      lint(
        '/* M40 8 L43 36 L72 40 */\n.mark { background: var(--color-bg-main); }'
      )
    ).toEqual([]);
    expect(
      lint('.mark { background: radial-gradient(circle, red, blue); }')
    ).toEqual([]);
  });

  it('counts each declaration, not the stylesheet', () => {
    const result = lintCss(rule, {
      'src/a.css': '.a { color: red; } .b { margin: 0; }',
    });
    expect(result.sites.get('no-sparkle')).toBe(2);
  });

  it('fails the presence floor on an empty tree', () => {
    const result = lintCss(
      rule,
      { 'src/a.css': '.a { color: red; }' },
      { measured: true }
    );
    expect(result.errors.join('\n')).toContain('floor');
  });
});
