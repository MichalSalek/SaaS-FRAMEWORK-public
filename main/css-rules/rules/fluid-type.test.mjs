// @vitest-environment node
import { describe, expect, it } from 'vitest';
import rule from './fluid-type.mjs';
import { lintCss } from '../test-utils.mjs';

const lint = (css, file = 'src/UI/features/x/a.module.css') =>
  lintCss(rule, { [file]: css });

describe('css/fluid-type', () => {
  it('rejects a hand-rolled font-size clamp in a module', () => {
    for (const css of [
      '.a { font-size: clamp(24px, 3.4vw, 36px); }',
      '.a {\n  font-size:\n    clamp(1.5rem, 1rem + 2vw, 2.25rem);\n}',
      '.a { FONT-SIZE: clamp(20px, 2vw, 26px) !important; }',
    ]) {
      expect(lint(css).findings, css).toHaveLength(1);
    }
  });
  it('rejects a bare fluid-allow marker', () => {
    expect(
      lint(
        '.a {\n  /* fluid-allow: */\n  font-size: clamp(20px, 2vw, 26px);\n}'
      ).findings
    ).toHaveLength(1);
  });
  it('accepts the scale, prose, strings, other props, the token sheet and a reasoned escape', () => {
    for (const css of [
      '.a { font-size: var(--text-fluid-xl); }',
      '/* font-size: clamp(24px, 3vw, 36px) */ .a { font-size: var(--text-fluid-lg); }',
      ".a::after { content: 'font-size: clamp(1px, 2vw, 3px)'; }",
      '.a { width: clamp(200px, 50vw, 400px); }',
      '.a {\n  /* fluid-allow: countdown figure */\n  font-size: clamp(48px, 10vw, 120px);\n}',
      '/* fluid-allow: blog title */\n\n\n.a { font-size: clamp(48px, 10vw, 120px); }',
    ]) {
      expect(lint(css).findings, css).toHaveLength(0);
    }
    expect(
      lint(
        '.a { font-size: clamp(1rem, 2vw, 2rem); }',
        'src/UI/styles/tokens.css'
      ).findings
    ).toHaveLength(0);
  });
  it('fails the presence floor over a tree without font sizes', () => {
    expect(
      lintCss(
        rule,
        { 'src/a.module.css': '.a{color:red}' },
        { measured: true }
      ).errors.join()
    ).toContain('floor');
  });
});
