

import { countSite, staticPropertyName } from '../lib.mjs';

const NAME = 'tabular-nums-inline';
const VARIANT = /^(fontVariantNumeric|font-variant-numeric)$/;
const FEATURES = /^(fontFeatureSettings|font-feature-settings)$/;
const TABULAR = /(?<![\w-])tabular-nums(?![\w-])/;
const TNUM = /(?<![\w-])tnum(?![\w-])/;
const MARKER = /tnum-allow:[ \t]*[^\s*/]/;

function keyName(property) {
  if (!property.computed && property.key.type === 'Identifier') {
    return property.key.name;
  }
  if (
    property.key.type === 'Literal' &&
    typeof property.key.value === 'string'
  ) {
    return property.key.value;
  }
  return null;
}

/** Every static string part inside an expression (literals and template quasis, any depth). */
function stringParts(node) {
  const parts = [];
  const visit = current => {
    if (!current || typeof current.type !== 'string') {
      return;
    }
    if (current.type === 'Literal' && typeof current.value === 'string') {
      parts.push(current.value);
      return;
    }
    if (current.type === 'TemplateElement') {
      parts.push(current.value.cooked ?? '');
      return;
    }
    for (const [key, child] of Object.entries(current)) {
      if (key === 'parent' || key === 'range' || key === 'loc') {
        continue;
      }
      if (Array.isArray(child)) {
        child.forEach(visit);
      } else if (child && typeof child === 'object') {
        visit(child);
      }
    }
  };
  visit(node);
  return parts.join('\n');
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Inline tabular figures (fontVariantNumeric / fontFeatureSettings) need a `tnum-allow: <reason>` comment.',
    },
    schema: [],
    messages: {
      tabular:
        'Tabular figures in an inline style without a tnum-allow reason: the feature widens . , : ; to a digit and is inherited. Remove it, or add `// tnum-allow: <reason>` (digits only that change in place, or a column of integers).',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    function allowed(node) {
      const first = node.loc.start.line;
      const last = node.loc.end.line;
      return sourceCode
        .getAllComments()
        .some(
          comment =>
            comment.loc.end.line >= first - 2 &&
            comment.loc.start.line <= last &&
            MARKER.test(comment.value)
        );
    }

    function inspect(name, value, node) {
      const variant = VARIANT.test(name);
      if (!variant && !FEATURES.test(name)) {
        return;
      }
      countSite(NAME);
      const text = stringParts(value);
      const sets = variant ? TABULAR.test(text) : TNUM.test(text);
      if (sets && !allowed(node)) {
        context.report({ node, messageId: 'tabular' });
      }
    }

    return {
      JSXAttribute(node) {
        // Every inline style is a candidate place; counted so the floor means the scan sees TSX.
        if (
          node.name.type === 'JSXIdentifier' &&
          /style$/i.test(node.name.name)
        ) {
          countSite(NAME);
        }
      },
      Property(node) {
        if (node.parent?.type !== 'ObjectExpression') {
          return;
        }
        const name = keyName(node);
        if (name) {
          inspect(name, node.value, node);
        }
      },
      AssignmentExpression(node) {
        if (node.left.type !== 'MemberExpression') {
          return;
        }
        const name = staticPropertyName(node.left);
        if (name) {
          inspect(name, node.right, node);
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type !== 'MemberExpression' ||
          staticPropertyName(callee) !== 'setProperty' ||
          node.arguments.length < 2
        ) {
          return;
        }
        const [prop, value] = node.arguments;
        if (prop.type === 'Literal' && typeof prop.value === 'string') {
          inspect(prop.value, value, node);
        }
      },
    };
  },
};

export default {
  name: NAME,
  replaces: 'tests/audit/tabular-nums.sh (inline styles in TS/TSX)',
  rule,
  blocks: [
    {
      files: ['src/**/*.{ts,tsx}'],
      ignores: ['src/**/*.test.{ts,tsx}', 'src/READONLY-shared-kernel/**'],
    },
  ],
  presence: {
    minSites: 100,
    what: 'inline style attributes and numeric-figure style properties in src TS/TSX (measured 141)',
  },
  paths: ['src', 'src/UI/styles/global.css'],
};
