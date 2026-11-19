// nf/no-sparkle — no decorative stars in main/src.
//
// Successor of the TS half of tests/audit/no-sparkle.sh. SparkleIcon, StarIcon and StarSvg,
// `iconName: 'Sparkle'`, the star emoji and the 4-point path fragments are decoration.
// A comment naming the ban is not code. Stylesheets: css/no-sparkle.
import { countSite } from '../lib.mjs';
import { staticString } from './_guard-files.mjs';

const NAMES = new Set(['SparkleIcon', 'StarIcon', 'StarSvg']);
const NAME_RE = /\b(SparkleIcon|StarIcon|StarSvg)\b/;
const PATHS = [
  'L72 18 L78 20',
  'L13.5 9',
  'L40 50 L41 53',
  'M40 12 L42 36 L62 40',
  'M50 18 L52 46 L78 50',
  'M40 8 L43 36 L72 40',
  'L72 40 L43 44 L40 72',
];

function textHit(value) {
  if (value.includes('⭐')) {
    return 'star emoji';
  }
  if (PATHS.some(fragment => value.includes(fragment))) {
    return '4-point star path';
  }
  const name = NAME_RE.exec(value);
  return name ? name[1] : null;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'No decorative SparkleIcon, StarIcon, star paths or the star emoji.',
    },
    schema: [],
    messages: {
      banned:
        'Decorative star ({{what}}). Use a domain icon or no icon; a rating is not a star.',
    },
  },
  create(context) {
    const reported = new Set();
    function report(node, what) {
      const key = `${node.range?.[0] ?? 0}:${what}`;
      if (reported.has(key)) {
        return;
      }
      reported.add(key);
      context.report({ node, messageId: 'banned', data: { what } });
    }
    return {
      Identifier(node) {
        countSite('no-sparkle');
        if (NAMES.has(node.name)) {
          report(node, node.name);
        }
      },
      JSXIdentifier(node) {
        countSite('no-sparkle');
        if (NAMES.has(node.name)) {
          report(node, node.name);
        }
      },
      Literal(node) {
        countSite('no-sparkle');
        if (typeof node.value === 'string') {
          const hit = textHit(node.value);
          if (hit) {
            report(node, hit);
          }
        }
      },
      TemplateLiteral(node) {
        countSite('no-sparkle');
        if (node.expressions.length > 0) {
          return;
        }
        const hit = textHit(node.quasis[0].value.cooked ?? '');
        if (hit) {
          report(node, hit);
        }
      },
      JSXText(node) {
        countSite('no-sparkle');
        const hit = textHit(node.value);
        if (hit) {
          report(node, hit);
        }
      },
      Property(node) {
        countSite('no-sparkle');
        const key =
          node.key.type === 'Identifier'
            ? node.key.name
            : staticString(node.key);
        if (key === 'iconName' && staticString(node.value) === 'Sparkle') {
          report(node, "iconName: 'Sparkle'");
        }
      },
    };
  },
};

export default {
  name: 'no-sparkle',
  replaces: 'tests/audit/no-sparkle.sh',
  rule,
  blocks: [{ files: ['src/**/*.{ts,tsx}'] }],
  presence: {
    minSites: 200000,
    what: 'identifiers, literals and properties inspected for decorative stars',
  },
  paths: ['src/UI'],
};
