// @vitest-environment node
import { describe, expect, it } from 'vitest';
import rule, { BASELINE } from './motion-tokens.mjs';
import { lintCss } from '../test-utils.mjs';

const file = 'src/UI/features/x/a.module.css';
const lint = css =>
  lintCss(rule, { 'src/UI/styles/tokens.css': ':root{}', [file]: css });
const filler = Array.from(
  { length: BASELINE },
  (_, i) => `.f${i} { transition: opacity ${100 + i}ms; }`
).join('\n');
const rawCounts = css => lint(`${filler}\n${css}`).findings.length > 0;

describe('css/motion-tokens', () => {
  it('rejects a composite transition with its own curve (dead declaration)', () => {
    for (const css of [
      '.a { transition: transform var(--transition-normal) var(--ease-entrance); }',
      '.a { transition: opacity var(--transition-fast) cubic-bezier(0.2, 0, 0, 1); }',
      '.a {\n  transition:\n    color var(--transition-fast),\n    transform var(--transition-slow) ease-out;\n}',
      '.a { --card-transition: transform var(--transition-fast) linear; }',
      '.a { transition: transform var(--transition-normal) var(--spring-soft); }',
    ]) {
      expect(lint(css).findings, css).toHaveLength(1);
    }
  });
  it('accepts a composite alone, a duration with its own curve, prose and strings', () => {
    for (const css of [
      '.a { transition: transform var(--transition-normal), color var(--transition-fast); }',
      '.a { transition: transform var(--duration-200) var(--ease-entrance); }',
      '/* transition: transform var(--transition-normal) ease-out; */ .a { color: red; }',
      ".a::after { content: 'transition: x var(--transition-fast) linear'; }",
      '.a { transition-timing-function: linear; transition-duration: var(--duration-200); }',
    ]) {
      expect(lint(css).findings, css).toHaveLength(0);
    }
  });
  it('passes raw times up to the baseline and lists them above it', () => {
    expect(lint(filler).findings).toHaveLength(0);
    expect(
      lint(`${filler}\n.a { transition: opacity 180ms ease; }`).findings
    ).toHaveLength(BASELINE + 1);
  });
  it('counts raw times per part and not in tokens, prose or identifiers', () => {
    expect(rawCounts('.a { transition: opacity .2s; }')).toBe(true);
    expect(rawCounts('.a {\n  transition:\n    opacity\n    240ms;\n}')).toBe(
      true
    );
    expect(rawCounts('.a { transition: opacity var(--duration-200); }')).toBe(
      false
    );
    expect(
      rawCounts('/* transition: opacity 200ms */ .a { color: red; }')
    ).toBe(false);
    expect(rawCounts('.a { transition: var(--transition-200ms); }')).toBe(
      false
    );
    const tokens = lintCss(rule, {
      'src/UI/styles/tokens.css': `${filler}\n.a{transition: opacity 1s}`,
      [file]: '.a{}',
    });
    expect(tokens.findings).toHaveLength(0);
  });
  it('fails the presence floor over a tree without transitions', () => {
    expect(
      lintCss(
        rule,
        { 'src/UI/styles/tokens.css': ':root{}', [file]: '.a{color:red}' },
        { measured: true }
      ).errors.join()
    ).toContain('floor');
  });
});
