// nf/validation-i18n — kernel validators accumulate i18n KEYS, never hand-written sentences.
//
// Successor of tests/audit/validation-i18n.sh. VALIDATION_MESSAGES (`V`) in
// `.shared-kernel/domain/i18n/validation.i18n.ts` is the SSOT of validation message keys; a raw
// English sentence in an error slot reaches a PL/DE user untranslated, because no key ever resolves.
// The grep matched `returnObject.<field> += '<Letter…'` on one line or with the literal on the next.
// This rule reads every ACCUMULATOR WRITE in the validator files: `<any member> += <rhs>` and
// `<member> = <same member> … + <rhs>` (the zod engine's `fields[slot] = (fields[slot] ?? '') + …`),
// whatever the receiver is called. It flattens the `+` chain of the right-hand side and reports any
// string or template literal in it whose text contains a letter: a key comes in as `V.section.key`
// or a variable, and only glue such as `' '` may be written by hand. A sentence in a comment is not
// a value and does not count.
// Scope (unchanged): the files directly in `.shared-kernel/policies/validation/`. Zod `message:` /
// `.refine` forms are deliberately NOT read here; their i18n fidelity is a runtime test
// (web-1 `validation-i18n-fidelity.test.ts`, DECISION in the shell guard's header).
import { countSite, unwrapTs } from '../lib.mjs';

const isPlus = node =>
  node?.type === 'BinaryExpression' && node.operator === '+';

function operands(node, out) {
  const value = unwrapTs(node);
  if (isPlus(value)) {
    operands(value.left, out);
    operands(value.right, out);
  } else if (value?.type === 'LogicalExpression') {
    operands(value.left, out);
    operands(value.right, out);
  } else if (value?.type === 'ConditionalExpression') {
    operands(value.consequent, out);
    operands(value.alternate, out);
  } else if (value) {
    out.push(value);
  }
  return out;
}

function literalText(node) {
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  if (node.type === 'TemplateLiteral') {
    return node.quasis
      .map(quasi => quasi.value.cooked ?? quasi.value.raw)
      .join('');
  }
  return null;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Validator error slots accumulate V.* i18n keys, never raw sentences.',
    },
    schema: [],
    messages: {
      literal:
        'Hand-written message `{{text}}` in a validator error slot: return a V.<section>.<key> key from validation.i18n.ts (translated in common.json in three languages).',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    return {
      AssignmentExpression(node) {
        const target = unwrapTs(node.left);
        if (target?.type !== 'MemberExpression') {
          return;
        }
        let parts;
        if (node.operator === '+=') {
          parts = operands(node.right, []);
        } else if (node.operator === '=' && isPlus(unwrapTs(node.right))) {
          const all = operands(node.right, []);
          const targetText = sourceCode.getText(target);
          if (!all.some(part => sourceCode.getText(part) === targetText)) {
            return;
          }
          parts = all;
        } else {
          return;
        }
        countSite('validation-i18n');
        for (const part of parts) {
          const text = literalText(part);
          if (text !== null && /[A-Za-z]/.test(text)) {
            context.report({
              node: part,
              messageId: 'literal',
              data: { text: text.trim().slice(0, 60) },
            });
          }
        }
      },
    };
  },
};

// Accumulator writes inspected, measured 2026-10-23: 2 (validation.utils.ts `returnObject.id +=`,
// validation.zod.ts `fields[slot] = (fields[slot] ?? '') + …`). After the zod migration the shape is
// nearly extinct, so the floor is 1: zero means the anchor itself moved.
export default {
  name: 'validation-i18n',
  replaces: 'tests/audit/validation-i18n.sh',
  rule,
  blocks: [{ files: ['.shared-kernel/policies/validation/*.ts'] }],
  presence: {
    minSites: 1,
    what: 'error-slot accumulator writes in .shared-kernel/policies/validation',
  },
  paths: ['.shared-kernel/policies/validation'],
};
