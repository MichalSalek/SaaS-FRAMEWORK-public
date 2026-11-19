// nf/legacy-spacing-scale — the removed ordinal spacing scale var(--sp-N) never returns in TSX.
//
// Successor of the TSX half of the legacy check in tests/audit/spacing-tokens.sh (stylesheets:
// css/spacing-tokens). The --sp-0..9 scale was deleted from tokens.css, so every use is a ghost
// (an undefined var in a shorthand drops the whole declaration). Root: every .tsx under src.
// Strings and template literals are read ON PURPOSE (an inline style value lives in a string);
// comments never count. Map: sp-0=4 sp-1=8 sp-2=12 sp-3=20 sp-4=32 sp-5=48 sp-6=64 sp-7=80
// sp-8=96 sp-9=128 → --space-<px>.
import { countSite } from '../lib.mjs';

const LEGACY = /var\(--sp-[0-9]\)/;

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'The removed --sp-N spacing scale; use --space-<px>.',
    },
    schema: [],
    messages: {
      legacy:
        'removed spacing scale var(--sp-N) (undefined var); use --space-<px> (sp-0=4 sp-1=8 sp-2=12 sp-3=20 sp-4=32 sp-5=48 sp-6=64 sp-7=80 sp-8=96 sp-9=128).',
    },
  },
  create(context) {
    const inspect = (node, text) => {
      if (!text.includes('var(--')) {
        return;
      }
      countSite('legacy-spacing-scale');
      if (LEGACY.test(text)) {
        context.report({ node, messageId: 'legacy' });
      }
    };
    return {
      Literal(node) {
        if (typeof node.value === 'string') {
          inspect(node, node.value);
        }
      },
      TemplateElement(node) {
        inspect(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};

export default {
  name: 'legacy-spacing-scale',
  replaces: 'tests/audit/spacing-tokens.sh (var(--sp-N) in TSX)',
  rule,
  blocks: [{ files: ['src/**/*.tsx'] }],
  presence: { minSites: 200, what: 'string literals with var(--…) in src TSX' },
  paths: ['src'],
};
