// @vitest-environment node
import { describe, expect, it } from 'vitest';
import rule from './no-view-transition.mjs';
import { lintCss } from '../test-utils.mjs';

const lint = css =>
  lintCss(rule, { 'src/UI/layouts/a.module.css': css }).findings;

describe('css/no-view-transition', () => {
  it('rejects the view-transition pseudo and accepts a data-nav read', () => {
    expect(
      lint('::view-transition-old(root) { animation: none; }')
    ).toHaveLength(1);
    expect(
      lint('html[data-nav-phase="exiting"] .shell { opacity: 0; }')
    ).toEqual([]);
    expect(
      lint('/* ::view-transition-old(root) { } */\n.shell { opacity: 1; }')
    ).toEqual([]);
  });

  it('counts each style rule, not the stylesheet', () => {
    const result = lintCss(rule, {
      'src/a.css': '.a { color: red; } .b { color: blue; }',
    });
    expect(result.sites.get('no-view-transition')).toBe(2);
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
