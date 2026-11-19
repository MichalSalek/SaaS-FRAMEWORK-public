// nf/shape-inline-radius — an inline corner reads a --style-radius-* role, never a literal.
//
// Successor of the TSX half (R6) of tests/audit/shape-tokens.sh (stylesheets: css/shape-tokens).
// Roots: every .tsx under src/UI and src/pages. Reported: a `borderRadius` object property whose
// value is a number (`borderRadius: 9999`, also 0, as the retired script read it) or a numeric
// string ('8px', '50%', '1rem'), also through a conditional branch. Legal: a role token
// ('var(--style-radius-round)') or any computed value. Escape: `shape-allow: <reason>` in a comment
// on the line or up to three lines above; a bare marker without a reason does not escape.
import { countSite, unwrapTs } from '../lib.mjs';
import { escapeNear } from './_escape-near.mjs';

const NUMERIC = /^\s*[0-9.]+(?:px|rem|em|%)?\s*$/;

function keyName(property) {
  if (property.key.type === 'Identifier' && !property.computed) {
    return property.key.name;
  }
  return property.key.type === 'Literal' ? String(property.key.value) : null;
}

function literalRadius(raw) {
  const node = unwrapTs(raw);
  if (node.type === 'ConditionalExpression') {
    return literalRadius(node.consequent) || literalRadius(node.alternate);
  }
  if (node.type === 'Literal') {
    return (
      typeof node.value === 'number' ||
      (typeof node.value === 'string' && NUMERIC.test(node.value))
    );
  }
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return NUMERIC.test(node.quasis[0].value.cooked ?? '');
  }
  return false;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Inline borderRadius takes a --style-radius-* role, not a literal.',
    },
    schema: [],
    messages: {
      literal:
        '[R6] inline borderRadius with a literal; use var(--style-radius-*) (or /* shape-allow: <reason> */).',
      bare: '[R6] "shape-allow:" without a reason does not escape an inline borderRadius literal.',
    },
  },
  create(context) {
    return {
      Property(node) {
        if (keyName(node) !== 'borderRadius') {
          return;
        }
        countSite('shape-inline-radius');
        if (!literalRadius(node.value)) {
          return;
        }
        const state = escapeNear(context.sourceCode, node, 'shape-allow', 3);
        if (state !== 'reason') {
          context.report({
            node,
            messageId: state === 'bare' ? 'bare' : 'literal',
          });
        }
      },
    };
  },
};

export default {
  name: 'shape-inline-radius',
  replaces: 'tests/audit/shape-tokens.sh (R6, inline TSX)',
  rule,
  blocks: [{ files: ['src/UI/**/*.tsx', 'src/pages/**/*.tsx'] }],
  presence: {
    minSites: 4,
    what: 'borderRadius properties in src/UI and src/pages TSX',
  },
  paths: ['src/UI', 'src/pages'],
};
