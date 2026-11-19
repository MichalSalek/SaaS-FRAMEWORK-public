// @vitest-environment node
import { describe, expect, it } from 'vitest';
import rule from './shape-tokens.mjs';
import { lintCss } from '../test-utils.mjs';

// Stylesheet samples of the retired tests/audit/_fixtures/shape-tokens (same verdicts; the TSX
// samples are in eslint-rules/rules/shape-inline-radius.test.mjs).
const FIXTURES = {
  'must-fail': {
    'corner-radius.module.css': '.tab {\n  border-top-left-radius: 6px;\n}\n',
    'multi-radius.module.css':
      '.island {\n  border-radius: 0 0 20px 20px;\n}\n',
    'outline-frame.module.css':
      '.popup {\n  background: var(--color-bg-paper);\n  outline: 1px solid var(--color-border);\n}\n',
    'radius-fallback.module.css':
      '.card {\n  border-radius: var(--radius-md, 8px);\n}\n',
    'radius-scale.module.css':
      '.card {\n  border-radius: var(--radius-md);\n}\n',
    'raw-border-width.module.css': '.card {\n  border-width: 1.5px;\n}\n',
    'raw-border.module.css':
      '.card {\n  border: 1px solid var(--color-border);\n}\n',
    'raw-divider.module.css':
      '.row {\n  border-bottom: 2px solid var(--color-divider);\n}\n',
    'raw-radius.module.css': '.card {\n  border-radius: 8px;\n}\n',
    'round-literal.module.css': '.dot {\n  border-radius: 50%;\n}\n',
    'side-width.module.css':
      '.rail {\n  border: var(--style-border-surface) solid var(--color-border);\n  border-left-width: 1px;\n}\n',
    'small-caps.module.css': '.label {\n  font-variant: small-caps;\n}\n',
    'uppercase.module.css': '.label {\n  text-transform: uppercase;\n}\n',
  },
  'must-pass': {
    'allow-comment.module.css':
      '.notch {\n  /* shape-allow: wycięcie ramki telefonu jest rysunkiem, nie kontrolką */\n  border-radius: 3px;\n}\n',
    'comment-only.module.css':
      '/* border: 1px solid red; text-transform: uppercase; border-radius: var(--radius-md) */\n.card {\n  border: var(--style-border-surface) solid var(--color-border);\n}\n',
    'focus-outline.module.css':
      '.chip:focus-visible {\n  outline: 2px solid var(--color-focus-ring);\n  outline-offset: 2px;\n}\n.chip {\n  border: var(--style-border-control) solid var(--color-border);\n}\n',
    'roles.module.css':
      '.card {\n  border: var(--style-border-surface) solid var(--color-border);\n  border-bottom: var(--style-border-divider) solid var(--color-divider);\n  border-radius: var(--style-radius-surface);\n}\n.pill {\n  border-radius: var(--style-radius-pill);\n}\n.reset {\n  border-radius: 0;\n  border: 0;\n}\n.label {\n  text-transform: var(--style-label-case);\n}\n.focus:focus-visible {\n  outline: 2px solid var(--color-focus-ring);\n  box-shadow: 0 0 0 1px var(--color-border);\n}\n',
    'zero-radius.module.css':
      '.reset {\n  border-radius: 0 0 0 0;\n  border-top-left-radius: 0;\n}\n',
  },
};

const lint = (css, file = 'src/UI/features/fixture/a.module.css') =>
  lintCss(rule, { [file]: css });

describe('css/shape-tokens', () => {
  it('keeps the verdicts of the retired fixtures', () => {
    for (const [file, css] of Object.entries(FIXTURES['must-fail'])) {
      expect(lint(css).findings.length, file).toBeGreaterThan(0);
    }
    for (const [file, css] of Object.entries(FIXTURES['must-pass'])) {
      expect(lint(css).findings, file).toHaveLength(0);
    }
  });
  it('rejects each rule in shapes the line grep missed', () => {
    for (const [css, id] of [
      ['.a { padding: 0; border-radius: var(--radius-lg); }', 'R1'],
      ['.a { --corner: var(--radius-sm); }', 'R1'],
      ['.a { border-end-start-radius: .5rem; }', 'R2'],
      ['.a {\n  border-radius:\n    0 0 12px 12px;\n}', 'R2'],
      ['.a { --card-border-radius: 8px; }', 'R2'],
      ['.a { font-variant-caps: all-small-caps; }', 'R3'],
      ['.a { text-transform: UPPERCASE; }', 'R3'],
      ['.a { border-inline-start-width: 2px; }', 'R4'],
      ['.a { border: solid 1px var(--color-border); }', 'R4'],
      ['.a { --card-border: 1px solid var(--color-border); }', 'R4'],
      ['@media (min-width: 768px) { .a { outline: 1px solid red; } }', 'R5'],
    ]) {
      const { findings } = lint(css);
      expect(findings, css).toHaveLength(1);
      expect(findings[0].message, css).toContain(`[${id}]`);
    }
  });
  it('accepts roles, resets, focus rings, prose, strings and the scale', () => {
    for (const css of [
      '.a { border: 0; border-radius: 0; border-top-width: 0px; }',
      '.a { border-radius: var(--style-radius-surface); border: var(--style-border-control) solid var(--color-border); }',
      '.a:focus-within { outline: 2px solid var(--color-focus-ring); }',
      '.a { outline: none; outline-offset: 2px; box-shadow: 0 0 0 1px red; }',
      ".a::after { content: 'border: 1px solid; text-transform: uppercase'; }",
      '/* border-radius: 8px */ .a { color: red; }',
      '.a { text-transform: var(--style-label-case); font-variant-numeric: tabular-nums; }',
    ]) {
      expect(lint(css).findings, css).toHaveLength(0);
    }
    expect(
      lint('.a { border-radius: 8px; }', 'src/UI/styles/tokens.css').findings
    ).toHaveLength(0);
    expect(
      lint('.a { border-radius: 8px; }', 'src/pages/x.module.css').findings
    ).toHaveLength(1);
  });
  it('accepts shape-allow with a reason up to three lines above, rejects a bare or distant one', () => {
    expect(
      lint(
        '.a {\n  /* shape-allow: drawn bezel */\n\n\n  border-radius: 3px;\n}'
      ).findings
    ).toHaveLength(0);
    expect(
      lint('.a { border-radius: 3px; /* shape-allow: drawn notch */ }').findings
    ).toHaveLength(0);
    expect(
      lint('.a {\n  /* shape-allow: */\n  border-radius: 3px;\n}').findings
    ).toHaveLength(1);
    expect(
      lint('.a {\n  /* shape-allow: far */\n\n\n\n  border-radius: 3px;\n}')
        .findings
    ).toHaveLength(1);
  });
  it('fails the presence floor over a tree without shape declarations', () => {
    expect(
      lintCss(
        rule,
        { 'src/UI/a.css': '.a{color:red}' },
        { measured: true }
      ).errors.join()
    ).toContain('floor');
  });
});
