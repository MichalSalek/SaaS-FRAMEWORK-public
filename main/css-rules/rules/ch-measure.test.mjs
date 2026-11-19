// @vitest-environment node
import { describe, expect, it } from 'vitest';
import rule from './ch-measure.mjs';
import { lintCss } from '../test-utils.mjs';

const TOKENS = ':root { --ch-body: 0.55em; --ch-heading: 0.6em; }';
const lint = css => lintCss(rule, { 'src/UI/styles/tokens.css': TOKENS, 'src/UI/a.module.css': css });

describe('css/ch-measure', () => {
  it('rejects a raw ch length in every position', () => {
    for (const css of [
      '.a { max-width: 56ch; }',
      '.a { width: var(--x, 16ch); }',
      '.a { flex: 1 1 40ch; }',
      '.a { max-width: min(72ch, 760px); }',
      '.a { max-width: .5ch; }',
      '@container (min-width: 40ch) { .a { color: red; } }',
    ]) {
      expect(lint(css).findings, css).toHaveLength(1);
    }
  });
  it('rejects a bare allow marker without a reason', () => {
    expect(lint('.a {\n  /* ch-allow: */\n  max-width: 56ch;\n}').findings).toHaveLength(1);
  });
  it('accepts tokens, prose, strings, identifiers and a documented exception', () => {
    for (const css of [
      '.a { max-width: calc(30 * var(--ch-body)); }',
      '/* never write max-width: 56ch */ .a { color: red; }',
      ".a::after { content: '12ch'; }",
      '.patch { --ch-body-x: 1px; color: #12ch; }',
      '.mono {\n  /* ch-allow: monospace column, not Schibsted */\n  width: 12ch;\n}',
      '.mono { width: 12ch; /* ch-allow: monospace column */ }',
    ]) {
      expect(lint(css).findings, css).toHaveLength(0);
    }
  });
  it('fails when the anchor stops defining the tokens', () => {
    const result = lintCss(rule, { 'src/UI/styles/tokens.css': ':root{}', 'src/a.css': '.a{}' });
    expect(result.errors.join()).toContain('--ch-body');
  });
  it('fails the presence floor when no measure uses a token', () => {
    const result = lintCss(rule, { 'src/UI/styles/tokens.css': TOKENS, 'src/a.css': '.a{color:red}' }, { measured: true });
    expect(result.errors.join()).toContain('floor');
  });
});
