// @vitest-environment node
import { describe, expect, it } from 'vitest';
import rule from './eyebrow-headline-dup.mjs';
import { lintCss } from '../test-utils.mjs';

const lint = css =>
  lintCss(rule, { 'src/UI/features/fixture/page.module.css': css }).findings;

describe('css/eyebrow-headline-dup', () => {
  it('rejects a local definition, a compound selector and a pseudo', () => {
    expect(lint('.sectionHeadline { font-size: 2rem; }')).toHaveLength(1);
    expect(lint('.wrap .sectionEyebrow { color: red; }')).toHaveLength(1);
    expect(lint('.sectionHeadline::before { content: ""; }')).toHaveLength(1);
    expect(lint('.foo.sectionHeadline { color: red; }')).toHaveLength(1);
  });

  it('accepts a comment, a different class and a usage that is not a definition', () => {
    expect(
      lint(
        '/* .sectionHeadline { font-size: 2rem; } */\n.faqHeadline { color: red; }'
      )
    ).toEqual([]);
    expect(lint('.sectionHeadlineSize { font-size: 2rem; }')).toEqual([]);
  });

  it('rejects a selector whose brace is on the next line', () => {
    expect(lint('.wrap\n.sectionHeadline\n{\n  color: red;\n}')).toHaveLength(
      1
    );
  });

  it('counts each selector, not the stylesheet', () => {
    const result = lintCss(rule, {
      'src/a.css': '.a { color: red; } .b { color: blue; }',
    });
    expect(result.sites.get('eyebrow-headline-dup')).toBe(2);
  });

  it('fails the presence floor on an empty tree', () => {
    const result = lintCss(
      rule,
      { 'src/a.css': '.a { color: red; }' },
      { measured: true }
    );
    expect(result.errors.join('\n')).toContain('floor');
  });
});
