// css/eyebrow-headline-dup — `.sectionEyebrow` / `.sectionHeadline` are defined once.
//
// Successor of tests/audit/eyebrow-headline-dup.sh. SectionHeader and Eyebrow own those
// classes; a page steers scale with the --section-headline-* hooks. The shell matched a
// selector line that both names the class and ends in `{`, so a class split from its brace
// was invisible. PostCSS sees the selector whatever the line break. A mention in a comment
// is not a definition. Allowlist is empty, same as the shell.
import { blocksOf, headOf } from './_scope.mjs';

const CLASS_RE = /\.(sectionHeadline|sectionEyebrow)(?![A-Za-z0-9_-])/;

export default {
  name: 'eyebrow-headline-dup',
  replaces: 'tests/audit/eyebrow-headline-dup.sh',
  files: ['src/**/*.css'],
  ignores: [],
  paths: ['src/UI/components/SectionHeader/SectionHeader.module.css'],
  presence: {
    minSites: 3500,
    what: 'style rules whose selectors were inspected',
  },
  check(root, ctx) {
    for (const block of blocksOf(root)) {
      if (block.type !== 'rule') {
        continue;
      }
      ctx.site();
      const selector = block.selector.replace(/\s+/g, ' ');
      if (!CLASS_RE.test(selector)) {
        continue;
      }
      ctx.report(
        block,
        `[${headOf(block)}] duplicate .sectionHeadline/.sectionEyebrow; use SectionHeader and the --section-headline-* hooks`
      );
    }
  },
};
