// @vitest-environment node
import { describe, expect, it } from 'vitest';
import rule from './no-split-bg.mjs';
import { lintCss } from '../test-utils.mjs';

const FIXTURES = [
  {
    sample: 'must-fail/single-line-block.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/single-line-block.module.css':
        ".rail::before { content: ''; position: absolute; inset: 0 0 0 auto; width: 38%; background: var(--color-surface); }\n",
    },
    frags: ['two-colour %-width band'],
  },
  {
    sample: 'must-pass/single-line-escape.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/single-line-escape.module.css':
        "/* split-bg-allow: pasek postepu, nie band sekcji */\n.bar::before { content: ''; position: absolute; inset: 0 0 0 auto; width: 38%; background: var(--color-surface); }\n",
    },
    frags: ['two-colour %-width band'],
  },
];

const lint = css =>
  lintCss(rule, { 'src/UI/features/x/x.module.css': css }).findings;
const BAND =
  'position: absolute; inset: 0 0 0 auto; width: 38%; background: var(--color-surface);';

describe('css/no-split-bg', () => {
  // Every sample of the retired tests/audit/_fixtures/<old-name> (same verdict; the fragments are
  // the old .expect / .expect-not lines in this rule's wording).
  for (const sample of FIXTURES) {
    it(`fixture ${sample.sample}`, () => {
      const { findings } = lintCss(rule, sample.files);
      const text = findings.map(f => f.message).join('\n');
      if (sample.fail) {
        expect(findings.length, sample.sample).toBeGreaterThan(0);
        for (const fragment of sample.frags) {
          expect(text).toContain(fragment);
        }
      } else {
        expect(findings, sample.sample).toEqual([]);
      }
    });
  }

  it('rejects both mirrored pins, a plain stylesheet and a band split across nesting', () => {
    expect(lint(`.hero::before { ${BAND} }`)).toHaveLength(1);
    expect(
      lint(
        '.hero::before { inset: 0 auto 0 0; width: 42.5%; background-color: var(--color-ink); }'
      )
    ).toHaveLength(1);
    expect(
      lintCss(rule, { 'src/UI/styles/x.css': `.hero::before { ${BAND} }` })
        .findings
    ).toHaveLength(1);
    expect(
      lint(
        '.hero::before { inset: 0 0 0 auto; width: 38%; &:hover { background: var(--color-surface); } }'
      ).length
    ).toBeGreaterThan(0);
  });

  it('accepts a photo panel, a progress fill and a skeleton line', () => {
    expect(
      lint(
        '.photo { inset: 0 0 0 auto; width: min(42vw, 520px); background: var(--color-ink); }'
      )
    ).toEqual([]);
    expect(
      lint(
        '.fill { inset: 0 auto 0 0; width: var(--limit-pct); background: var(--color-primary); }'
      )
    ).toEqual([]);
    expect(
      lint('.line { width: 40%; background: var(--color-surface); }')
    ).toEqual([]);
  });

  it('does not count prose and needs a reason on the escape', () => {
    expect(lint(`/* .x { ${BAND} } */ .a { width: 10%; }`)).toEqual([]);
    expect(
      lint(`/* split-bg-allow: */\n.bar::before { ${BAND} }`)[0].message
    ).toContain('without a reason');
    expect(
      lint(
        `/* split-bg-allow: progress track, not a section band */\n.bar::before { ${BAND} }`
      )
    ).toEqual([]);
  });

  it('fails the presence floor on an empty tree', () => {
    const result = lintCss(
      rule,
      { 'src/UI/a.module.css': '.a { color: red; }' },
      { measured: true }
    );
    expect(result.errors.join()).toContain('floor');
  });
});
