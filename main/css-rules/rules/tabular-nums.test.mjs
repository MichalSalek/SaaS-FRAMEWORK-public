// @vitest-environment node
import { describe, expect, it } from 'vitest';
import rule from './tabular-nums.mjs';
import { lintCss } from '../test-utils.mjs';

const ANCHOR =
  '/* DECISION … every use carries `tnum-allow: <reason>` */ .data-count { color: red; }';
const lint = css =>
  lintCss(rule, {
    'src/UI/styles/global.css': ANCHOR,
    'src/UI/features/fixture/card.module.css': css,
  });

describe('css/tabular-nums', () => {
  it('rejects the retired must-fail fixtures', () => {
    for (const css of [
      // bare-declaration
      '.date {\n  font-variant-numeric: tabular-nums;\n}\n',
      // shorthand-value
      '.price {\n  font-variant-numeric: lining-nums tabular-nums;\n}\n',
      // broken-across-lines
      '.price {\n  font-variant-numeric:\n    lining-nums\n    tabular-nums;\n}\n',
      // feature-settings
      ".price {\n  font-feature-settings: 'tnum' 1;\n}\n",
      // bare-escape-marker
      '.date {\n  /* tnum-allow: */\n  font-variant-numeric: tabular-nums;\n}\n',
    ]) {
      expect(lint(css).findings, css).toHaveLength(1);
    }
  });
  it('rejects other spellings: double quotes, custom property, one-line block, at-rule, marker too far', () => {
    for (const css of [
      '.a { font-feature-settings: "tnum", "lnum"; }',
      '.a { --nums: tabular-nums; }',
      '.a{font-variant-numeric:tabular-nums}',
      '@supports (font-variant-numeric: tabular-nums) { .a { color: red; } }',
      '/* tnum-allow: far away */\n\n\n.a {\n  font-variant-numeric: tabular-nums;\n}',
      '.a { font-variant-numeric: tabular-nums; }\n/* tnum-allow: a marker below the site does not count */\n.b { color: red; }',
    ]) {
      expect(lint(css).findings, css).toHaveLength(1);
    }
  });
  it('accepts the retired must-pass fixtures, prose and documented exceptions', () => {
    for (const css of [
      // documented-use
      '.counter {\n  /* tnum-allow: live character counter while typing; digits and a slash */\n  font-variant-numeric: tabular-nums;\n}\n',
      // prose-only
      '/* We removed font-variant-numeric: tabular-nums here: it spaced out the date. */\n.date {\n  color: var(--color-text-secondary);\n}\n',
      '.a {\n  /* font-variant-numeric: tabular-nums;\n     font-feature-settings: "tnum"; */\n  color: red;\n}',
      ".a::after { content: 'tabular-nums'; }",
      '.tabular-numsish { font-variant-numeric: lining-nums; font-feature-settings: "lnum"; }',
      '.a { font-variant-numeric: tabular-nums; /* tnum-allow: same line after the value */ }',
      '.a {\n  font-variant-numeric: /* tnum-allow: inside the value */ tabular-nums;\n}',
      '.a {\n  /* tnum-allow: a column of integers */\n  font-variant-numeric:\n    lining-nums\n    tabular-nums;\n}',
    ]) {
      expect(lint(css).findings, css).toHaveLength(0);
    }
  });
  it('fails when the anchor no longer documents the marker', () => {
    const result = lintCss(rule, {
      'src/UI/styles/global.css': '.a{}',
      'src/a.css': '.a{}',
    });
    expect(result.errors.join()).toContain('tnum-allow');
  });
  it('fails when the anchor is gone', () => {
    const result = lintCss(rule, { 'src/a.css': '.a{}' });
    expect(result.errors.join()).toContain('does not exist');
  });
  it('fails the presence floor when no numeric-figure declaration is seen', () => {
    const result = lintCss(
      rule,
      { 'src/UI/styles/global.css': ANCHOR, 'src/a.css': '.a{color:red}' },
      { measured: true }
    );
    expect(result.errors.join()).toContain('floor');
  });
});
