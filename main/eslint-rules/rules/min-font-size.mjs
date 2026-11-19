// nf/min-font-size — no raw font size below the 16px floor in TypeScript (owner hard directive).
//
// Successor of the .ts/.tsx half of tests/audit/min-font-size.sh (stylesheets: css/min-font-size).
// Root: every .ts/.tsx under src. Reported:
//   - a `fontSize` (or 'font-size') object property whose value is a number below 16, a string that
//     breaks the floor ('12px', '0.9em', '85%', 'clamp(12px, …)'), or a conditional with such a
//     branch: inline styles and the OG card builders (React.createElement in plain .ts);
//   - CSS text inside a string or template literal (`font-size: 12px` in a <style> string or an
//     e-mail template): strings are read ON PURPOSE here, that is where those values live.
// Comments never count. The floor itself (px, relative < 1, percent < 100, smallest length inside
// clamp/min/max) is css-rules/rules/_font-floor.mjs, one definition for both halves.
// No allowlist: the four /dev pages the retired script grandfathered hold no raw size below the
// floor any more, so their exemption was dead and is not carried over.
import { countSite, unwrapTs } from '../lib.mjs';
import {
  FONT_FLOOR_PX,
  fontFloorViolation,
} from '../../css-rules/rules/_font-floor.mjs';

const KEYS = new Set(['fontSize', 'font-size']);
const CSS_FONT_SIZE = /font-size\s*:\s*([^;}"'`]*)/gi;

function keyName(property) {
  if (property.computed) {
    return property.key.type === 'Literal' ? String(property.key.value) : null;
  }
  if (property.key.type === 'Identifier') {
    return property.key.name;
  }
  return property.key.type === 'Literal' ? String(property.key.value) : null;
}

function staticString(node) {
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0].value.cooked ?? '';
  }
  return null;
}

/** Why a fontSize value breaks the floor, or null. */
function valueViolation(raw) {
  const node = unwrapTs(raw);
  if (node.type === 'ConditionalExpression') {
    return valueViolation(node.consequent) ?? valueViolation(node.alternate);
  }
  if (node.type === 'Literal' && typeof node.value === 'number') {
    return node.value < FONT_FLOOR_PX
      ? `${node.value} below the ${FONT_FLOOR_PX}px floor`
      : null;
  }
  const text = staticString(node);
  return text === null ? null : fontFloorViolation(text);
}

const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'No raw font size below 16px; use a --text-* token.' },
    schema: [],
    messages: {
      inline:
        'fontSize {{why}}; use a --text-* token or a size >= 16px (DESIGN.md → Typografia).',
      css: 'font-size in a CSS string: {{why}}; use a --text-* token or a size >= 16px (DESIGN.md → Typografia).',
    },
  },
  create(context) {
    const owned = new WeakSet();
    const scanText = (node, text) => {
      for (const match of text.matchAll(CSS_FONT_SIZE)) {
        countSite('min-font-size');
        const why = fontFloorViolation(match[1]);
        if (why) {
          context.report({ node, messageId: 'css', data: { why } });
        }
      }
    };
    return {
      Property(node) {
        const name = keyName(node);
        if (!name || !KEYS.has(name)) {
          return;
        }
        countSite('min-font-size');
        const value = unwrapTs(node.value);
        if (value.type === 'Literal' || value.type === 'TemplateLiteral') {
          owned.add(value);
        }
        const why = valueViolation(node.value);
        if (why) {
          context.report({ node, messageId: 'inline', data: { why } });
        }
      },
      Literal(node) {
        if (typeof node.value === 'string' && !owned.has(node)) {
          scanText(node, node.value);
        }
      },
      TemplateLiteral(node) {
        if (owned.has(node)) {
          return;
        }
        for (const quasi of node.quasis) {
          scanText(node, quasi.value.cooked ?? quasi.value.raw);
        }
      },
    };
  },
};

export default {
  name: 'min-font-size',
  replaces: 'tests/audit/min-font-size.sh (.ts/.tsx)',
  rule,
  blocks: [{ files: ['src/**/*.{ts,tsx}'] }],
  presence: {
    minSites: 70,
    what: 'fontSize properties and font-size in strings',
  },
  paths: ['src', 'src/UI/styles/tokens.css'],
};
