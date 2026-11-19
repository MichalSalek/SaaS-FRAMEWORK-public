// @vitest-environment node
import { describe, expect, it } from 'vitest';
import rule, { BASELINE } from './breakpoints.mjs';
import { lintCss } from '../test-utils.mjs';

const file = 'src/UI/features/x/a.module.css';
/** n off-grid conditions plus the sample, so the ratchet fires exactly when the sample counts. */
const atBaseline = sample => {
  const filler = Array.from(
    { length: BASELINE },
    (_, i) => `@media (min-width: ${601 + i}px) { .f${i} { color: red; } }`
  ).join('\n');
  return lintCss(rule, { [file]: `${filler}\n${sample}` });
};
const counts = sample => atBaseline(sample).findings.length > 0;

describe('css/breakpoints', () => {
  it('passes at the baseline and lists every off-grid condition above it', () => {
    expect(atBaseline('').findings).toHaveLength(0);
    expect(
      atBaseline('@media (max-width: 900px) { .a { color: red; } }').findings
    ).toHaveLength(BASELINE + 1);
  });
  it('counts off-grid width conditions, also on a continuation line', () => {
    for (const css of [
      '@media (max-width: 900px) { .a { color: red; } }',
      '@media (min-width: 640px) { .a { color: red; } }',
      '@media screen and\n  (min-width: 1100px) { .a { color: red; } }',
      '@media (min-width: 480px) and (max-width: 600px) { .a { color: red; } }',
    ]) {
      expect(counts(css), css).toBe(true);
    }
  });
  it('does not count the grid, its complements, other queries, prose or an escape with a reason', () => {
    for (const css of [
      '@media (min-width: 480px) and (max-width: 767px) { .a { color: red; } }',
      '@media (min-width: 1024px), (max-width: 1279px) { .a { color: red; } }',
      '@media (hover: hover) and (pointer: fine) { .a { color: red; } }',
      '/* @media (max-width: 900px) */ .a { color: red; }',
      '@container (min-width: 900px) { .a { color: red; } }',
      '/* breakpoint-allow: phone frame geometry */\n@media (max-width: 900px) { .a { color: red; } }',
      '/* breakpoint-allow: admin table */\n\n\n\n@media (max-width: 900px) { .a { color: red; } }',
    ]) {
      expect(counts(css), css).toBe(false);
    }
  });
  it('counts a bare escape marker without a reason', () => {
    expect(
      counts(
        '/* breakpoint-allow: */\n@media (max-width: 900px) { .a { color: red; } }'
      )
    ).toBe(true);
  });
  it('fails the presence floor over a tree without width queries', () => {
    expect(
      lintCss(
        rule,
        { [file]: '.a{color:red}' },
        { measured: true }
      ).errors.join()
    ).toContain('floor');
  });
});
