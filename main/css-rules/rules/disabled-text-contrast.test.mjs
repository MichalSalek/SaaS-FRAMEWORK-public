// @vitest-environment node
import { describe, expect, it } from 'vitest';
import rule from './disabled-text-contrast.mjs';
import { lintCss } from '../test-utils.mjs';

const FILE = 'src/UI/features/fixture/x.module.css';
const lint = css => lintCss(rule, { [FILE]: css });

describe('css/disabled-text-contrast', () => {
  it('rejects the retired must-fail fixture (one-line block)', () => {
    const css =
      '/* Blok w JEDNEJ linii: liczenie klamer per linia dawalo `opens === closes`,\n   wiec regula byla dla straznika niewidzialna — falszywa zielen. */\n.meta { color: var(--color-text-disabled); }\n';
    expect(lint(css).findings).toHaveLength(1);
  });
  it('accepts the retired must-pass fixtures', () => {
    for (const css of [
      '.button:disabled { color: var(--color-text-disabled); }\n',
      '/* text-disabled-allow: separator dekoracyjny */\n.sep { color: var(--color-text-disabled); }\n',
    ]) {
      expect(lint(css).findings, css).toHaveLength(0);
    }
  });
  it('rejects readable text in other spellings and places', () => {
    for (const css of [
      '.date {\n  color: var(--color-text-disabled);\n}',
      '.date { color: var( --color-text-disabled ); }',
      '.date { color: var(--color-text-disabled, #aaa); }',
      '.date { color: color-mix(in oklch, var(--color-text-disabled) 90%, transparent); }',
      '.date { color: var(--color-text-disabled) !important; }',
      '@media (min-width: 768px) { .hint { color: var(--color-text-disabled); } }',
      '.card { & .meta { color: var(--color-text-disabled); } }',
      // a bare marker exempts nothing
      '/* text-disabled-allow: */\n.sep { color: var(--color-text-disabled); }',
      // an escape on a sibling block does not leak
      '.a {\n  /* text-disabled-allow: separator */\n  color: red;\n}\n.b { color: var(--color-text-disabled); }',
    ]) {
      expect(lint(css).findings, css).toHaveLength(1);
    }
  });
  it('accepts disabled state, escapes in scope, prose and non-text uses', () => {
    for (const css of [
      '.input[disabled] { color: var(--color-text-disabled); }',
      ".row[aria-disabled='true'] { color: var(--color-text-disabled); }",
      '.footerDisabled { color: var(--color-text-disabled); }',
      '.field { &:disabled { color: var(--color-text-disabled); } }',
      '.isDisabled { & .label { color: var(--color-text-disabled); } }',
      '.sep {\n  /* text-disabled-allow: decorative separator */\n  color: var(--color-text-disabled);\n}',
      '/* text-disabled-allow: null-state dim */\n@media (hover: hover) { .x { color: var(--color-text-disabled); } }',
      '/* color: var(--color-text-disabled); */ .a { color: var(--color-text-muted); }',
      ".a::after { content: 'color: var(--color-text-disabled)'; }",
      '.track { background: var(--color-text-disabled); }',
      '.a { --color-text-disabled: color-mix(in oklch, black 40%, white); }',
      '.a { border-color: var(--color-text-disabled); }',
    ]) {
      expect(lint(css).findings, css).toHaveLength(0);
    }
  });
  it('fails the presence floor when no text colour is seen', () => {
    const result = lintCss(
      rule,
      { 'src/UI/x.module.css': '.a{background:red}' },
      { measured: true }
    );
    expect(result.errors.join()).toContain('floor');
  });
});
