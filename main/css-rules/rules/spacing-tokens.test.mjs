// @vitest-environment node
import { describe, expect, it } from 'vitest';
import rule from './spacing-tokens.mjs';
import { lintCss } from '../test-utils.mjs';

const lint = (css, file = 'src/UI/features/x/a.module.css') =>
  lintCss(rule, { [file]: css });

describe('css/spacing-tokens', () => {
  it('rejects a raw px in every spacing property and shape', () => {
    for (const css of [
      '.a { margin: 6px; }',
      '.a { padding: 8px 12px; }',
      '.a { padding-inline-start: 10px; }',
      '.a { row-gap: 14px; }',
      '.a { inset-block-end: 3px; }',
      '.a { margin: 0 -2px; }',
      '.a {\n  padding:\n    4px\n    8px;\n}',
      '.a { .b { gap: 5px; } }',
      '@media (min-width: 768px) { .a { gap: 18px; } }',
    ]) {
      expect(lint(css).findings, css).toHaveLength(1);
    }
  });
  it('accepts resets, hairlines, relative and computed values, and non-spacing props', () => {
    for (const css of [
      '.a { margin: 0; padding: 0px; gap: 1px; margin-top: -1px; }',
      '.a { padding: 1em 2rem 5% 3vw; margin: auto; }',
      '.a { padding: calc(var(--space-8) + 2px); gap: max(8px, 1vw); margin: var(--space-6); }',
      '.a { padding: env(safe-area-inset-top, 12px); }',
      '.a { top: 12px; left: 6px; width: 40px; }',
      '/* padding: 6px */ .a { padding: var(--space-6); }',
      ".a { --pad: 'margin: 6px'; }",
    ]) {
      expect(lint(css).findings, css).toHaveLength(0);
    }
  });
  it('reads only CSS modules for the px rule', () => {
    expect(
      lint('.a { margin: 6px; }', 'src/UI/styles/global.css').findings
    ).toHaveLength(0);
  });
  it('accepts an optical escape with a reason in every scope the old script read', () => {
    for (const css of [
      '.a {\n  /* optical: glyph baseline */\n  margin-top: 3px;\n}',
      '.a { margin-top: 3px; /* optical: glyph baseline */ }',
      '/* optical: icon offset */\n.a { margin-top: 3px; }',
      '/* optical: whole band */\n@media (min-width: 768px) { .a { margin-top: 3px; } }',
      '/* optical: four lines up */\n\n\n\n.a { margin-top: 3px; }',
    ]) {
      expect(lint(css).findings, css).toHaveLength(0);
    }
  });
  it('rejects a bare optical marker and one in a sibling block more than four lines up', () => {
    for (const css of [
      '.a {\n  /* optical: */\n  margin-top: 3px;\n}',
      '/* optical: too far, and a block between */\n.b { color: red; }\n\n\n\n\n.a { margin-top: 3px; }',
      '.b { /* optical: sibling block */ }\n\n\n\n\n.a { margin-top: 3px; }',
    ]) {
      expect(lint(css).findings, css).toHaveLength(1);
    }
  });
  it('rejects the removed --sp-N scale anywhere in a stylesheet, not in prose', () => {
    expect(
      lint('.a { margin: var(--sp-2); }', 'src/UI/styles/global.css').findings
    ).toHaveLength(1);
    expect(lint('.a { --x: var(--sp-0); }').findings).toHaveLength(1);
    expect(
      lint('/* var(--sp-2) */ .a { margin: var(--space-12); }').findings
    ).toHaveLength(0);
    expect(lint(".a::after { content: 'var(--sp-2)'; }").findings).toHaveLength(
      0
    );
  });
  it('fails the presence floor over a tree without spacing', () => {
    expect(
      lintCss(
        rule,
        { 'src/a.module.css': '.a{color:red}' },
        { measured: true }
      ).errors.join()
    ).toContain('floor');
  });
});
