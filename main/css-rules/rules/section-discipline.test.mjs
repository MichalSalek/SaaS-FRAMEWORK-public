// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import rule from './section-discipline.mjs';
import { lintCss } from '../test-utils.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(
  HERE,
  '../../../tests/audit/_fixtures/section-discipline'
);

const read = name => readFileSync(path.join(FIXTURES, name), 'utf8');

function lintFiles(files) {
  return lintCss(rule, files).findings;
}

describe('css/section-discipline', () => {
  it('fixture must-fail/single-line-block', () => {
    const findings = lintFiles({
      'src/UI/features/fixture/single-line-block.module.css': read(
        'must-fail/single-line-block.module.css'
      ),
    });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.map(f => f.message).join('\n')).toContain(
      'manual breakout'
    );
  });

  it('fixture must-pass/single-line-hero', () => {
    const findings = lintFiles({
      'src/UI/features/fixture/single-line-hero.module.css': read(
        'must-pass/single-line-hero.module.css'
      ),
    });
    expect(findings).toEqual([]);
  });

  it('fixture must-pass/escape-above-block', () => {
    const findings = lintFiles({
      'src/UI/features/fixture/escape-above-block.module.css': read(
        'must-pass/escape-above-block.module.css'
      ),
    });
    expect(findings).toEqual([]);
  });

  it('accepts .page and calc(-50vw + 50%), rejects a bare marker and a nested non-shell', () => {
    expect(
      lintFiles({
        'src/UI/features/fixture/a.module.css':
          '.page { margin-left: calc(-50vw + 50%); }',
      })
    ).toEqual([]);
    expect(
      lintFiles({
        'src/UI/features/fixture/a.module.css':
          '/* section-discipline-allow: */\n.band { margin-left: calc(50% - 50vw); }',
      })
        .map(f => f.message)
        .join('\n')
    ).toContain('without a reason');
    expect(
      lintFiles({
        'src/UI/features/fixture/a.module.css':
          '.hero { .band { margin-left: calc(50% - 50vw); } }',
      })
    ).toHaveLength(1);
  });

  it('does not scan shared, playground, a comment or a component stylesheet', () => {
    const shared = {
      'src/UI/features/shared/reviews/x.module.css':
        '.section { margin-left: calc(50% - 50vw); }',
    };
    expect(lintFiles(shared)).toEqual([]);
    const play = {
      'src/UI/features/dev/playground/x.module.css':
        '.band { margin-left: calc(50% - 50vw); }',
    };
    expect(lintFiles(play)).toEqual([]);
    expect(
      lintFiles({
        'src/UI/features/fixture/a.module.css':
          '/* calc(50% - 50vw) */\n.band { color: red; }',
      })
    ).toEqual([]);
    expect(
      lintFiles({
        'src/UI/components/Section/Section.module.css':
          '.band { margin-left: calc(50% - 50vw); }',
      })
    ).toEqual([]);
  });

  it('counts each declaration, not the stylesheet', () => {
    const result = lintCss(rule, {
      'src/UI/features/fixture/a.module.css':
        '.a { color: red; } .b { margin: 0; }',
    });
    expect(result.sites.get('section-discipline')).toBe(2);
  });

  it('fails the presence floor on an empty tree', () => {
    const result = lintCss(
      rule,
      { 'src/UI/features/fixture/a.module.css': '.a { color: red; }' },
      { measured: true }
    );
    expect(result.errors.join('\n')).toContain('floor');
  });
});
