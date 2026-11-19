// nf/tint-inline-style — the "Jeden krem" theme in inline `style` props, where no stylesheet scan
// looks.
//
// Successor of the TSX half of tests/audit/tint-discipline.sh (the stylesheet half is
// css/tint-discipline in css-rules). An inline style is blind to every CSS guard: the gold
// 8/12/16% ladder cycled by `index % 3` in the session detail broke three theme rules there.
// Reported, in the value of a `style` / `*Style` JSX attribute:
//   - a color-mix with a gold token (seed, palette aliases, document-scope module aliases),
//   - the cream token var(--color-bg-subtle) (the one-band-per-page limit counts CSS only),
//   - a CHROMATIC hex, plain or URL-encoded in a data URI (`%23d4a840`),
//   - a raw chromatic colour function with alpha <= 0.45.
// The style may be an object literal or any expression; an identifier that is the style (or a
// ternary branch or a spread of it) is followed to its initialiser through scope analysis
// (`const rowStyle = {…}; style={rowStyle}`), chained. String content is read on purpose (CSS values live in strings); comments
// are blanked, so a rejected variant left in a comment does not count.
import { countSite, unwrapTs } from '../lib.mjs';
import {
  CREAM,
  MODULE_IGNORES,
  MODULE_ROOT,
  PALETTE_FILES,
  hasChromaticHex,
  rawColorTint,
  themeSetsFromDisk,
} from '../../css-rules/rules/_tint.mjs';

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'No gold tint, cream, chromatic hex or raw tint colour in an inline style; use a module class with a role token.',
    },
    schema: [],
    messages: {
      tint: 'Tint in an INLINE STYLE ({{shape}}): CSS guards are blind to it. Move it to the module and use a role token (DESIGN.md §Motyw „Jeden krem”).',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const { gold } = themeSetsFromDisk(context.cwd);

    function variableOf(identifier) {
      let scope = sourceCode.getScope(identifier);
      while (scope) {
        const found = scope.set.get(identifier.name);
        if (found) {
          return found;
        }
        scope = scope.upper;
      }
      return null;
    }

    /** Source text of a node with its comments blanked (same length, same lines). */
    function codeOf(node) {
      const [start, end] = node.range;
      let text = sourceCode.text.slice(start, end);
      for (const comment of sourceCode.getCommentsInside(node)) {
        const from = comment.range[0] - start;
        const to = comment.range[1] - start;
        text =
          text.slice(0, from) +
          text.slice(from, to).replace(/[^\n]/g, ' ') +
          text.slice(to);
      }
      return text;
    }

    /**
     * Text of the style expression plus the initialisers of the identifiers that ARE the style or
     * a structural part of it: the expression itself, a ternary / logical branch, a spread in the
     * object (`style={rowStyle}`, `style={a ? base : active}`, `style={{ ...base }}`), chained.
     * A value READ inside the object (`background: p.color`, `${stops}`) is not followed: data-viz
     * colours computed from tokens are not a style object.
     */
    function styleText(expression) {
      const parts = [];
      const seen = new Set();
      const visit = raw => {
        const node = unwrapTs(raw);
        if (!node) {
          return;
        }
        if (node.type === 'Identifier') {
          const variable = variableOf(node);
          if (!variable || seen.has(variable)) {
            return;
          }
          seen.add(variable);
          for (const def of variable.defs) {
            if (def.type === 'Variable' && def.node.init) {
              visit(def.node.init);
            }
          }
          return;
        }
        parts.push(codeOf(node));
        if (node.type === 'ConditionalExpression') {
          visit(node.consequent);
          visit(node.alternate);
        } else if (node.type === 'LogicalExpression') {
          visit(node.left);
          visit(node.right);
        } else if (node.type === 'ObjectExpression') {
          for (const property of node.properties) {
            if (property.type === 'SpreadElement') {
              visit(property.argument);
            }
          }
        }
      };
      visit(expression);
      return parts.join('\n');
    }

    return {
      JSXAttribute(node) {
        if (
          node.name.type !== 'JSXIdentifier' ||
          !/style$/i.test(node.name.name)
        ) {
          return;
        }
        if (
          node.value?.type !== 'JSXExpressionContainer' ||
          node.value.expression.type === 'JSXEmptyExpression'
        ) {
          return;
        }
        countSite('tint-inline-style');
        const expression = node.value.expression;
        const text = styleText(expression);
        const isMix = /color-mix\(/.test(text);
        const hasGold =
          isMix && [...gold].some(token => text.includes(`--${token}`));
        const hasCream = text.includes(`--${CREAM}`);
        if (
          hasGold ||
          hasCream ||
          hasChromaticHex(text) ||
          rawColorTint(text) !== null
        ) {
          const bare = unwrapTs(expression);
          const inner =
            bare.type === 'Identifier'
              ? bare.name
              : bare.type === 'ObjectExpression'
                ? '{…}'
                : '…';
          const shape = `${node.name.name}={${inner}}`;
          context.report({ node, messageId: 'tint', data: { shape } });
        }
      },
    };
  },
};

export default {
  name: 'tint-inline-style',
  replaces: 'tests/audit/tint-discipline.sh (inline style in TSX)',
  rule,
  blocks: [{ files: ['src/UI/**/*.tsx'], ignores: MODULE_IGNORES }],
  presence: {
    minSites: 60,
    what: 'style attributes in src/UI TSX (measured 90)',
  },
  paths: [MODULE_ROOT, ...PALETTE_FILES],
};
