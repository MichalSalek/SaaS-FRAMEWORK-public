// nf/aria-modal-focus-trap — `aria-modal` that can be true lives only in AppModalShell.
//
// Successor of tests/audit/aria-modal-focus-trap.sh. `aria-modal="true"` promises assistive tech
// that the background is inert and focus is trapped; a hand-rolled dialog without a trap breaks
// that promise (Tab escapes, no Escape, no focus restore). The one primitive that wires the whole
// contract (ref + useFocusTrap + role + aria-modal + tabIndex + restore) is `AppModalShell`;
// AppDialogAtom (Base UI) sets aria-modal at runtime and is not a literal.
//
// The rule reads the attribute, not the text, so `aria-modal={isOpen ? 'true' : undefined}`,
// `aria-modal={open}`, `{...{ 'aria-modal': true }}` and `createElement('div', { 'aria-modal':
// 'true' })` are all seen. It reports `aria-modal` (JSX attribute or object key) unless its value is
// statically false (`false`, `'false'`, `{false}`, `undefined`, or a conditional whose every branch
// is). Exempt: AppModalShell itself (block option `allow`), and a file carrying a comment
// `aria-modal-focus-trap-allow: <reason>` for a documented outlier (swipe drawer, inline alert).
// A bare marker without a reason does not count.
import { countSite } from '../lib.mjs';

const ESCAPE = /aria-modal-focus-trap-allow:\s*\S/;
const ATTRIBUTE = 'aria-modal';

/** True when the value can never be the string/boolean true. */
function staticallyFalse(node) {
  if (!node) {
    return false;
  }
  switch (node.type) {
    case 'Literal':
      return (
        node.value === false || node.value === 'false' || node.value === null
      );
    case 'Identifier':
      return node.name === 'undefined';
    case 'TemplateLiteral':
      return (
        node.expressions.length === 0 && node.quasis[0].value.cooked === 'false'
      );
    case 'ConditionalExpression':
      return (
        staticallyFalse(node.consequent) && staticallyFalse(node.alternate)
      );
    case 'TSAsExpression':
    case 'TSNonNullExpression':
    case 'TSSatisfiesExpression':
      return staticallyFalse(node.expression);
    case 'JSXExpressionContainer':
      return staticallyFalse(node.expression);
    default:
      return false;
  }
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'aria-modal that can be true only in AppModalShell (which traps and restores focus), or in a file with a documented outlier marker.',
    },
    schema: [
      {
        type: 'object',
        properties: { allow: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
    messages: {
      handRolled:
        'Hand-rolled aria-modal outside AppModalShell: use <AppModalShell> (src/UI/primitives/AppModalShell.atom.tsx), which traps and restores focus, or document a deliberate outlier with `// aria-modal-focus-trap-allow: <reason>`.',
    },
  },
  create(context) {
    const allow = context.options[0]?.allow ?? [];
    const filename = context.filename.replaceAll('\\', '/');
    const allowed = allow.some(fragment => filename.endsWith(fragment));
    const sourceCode = context.sourceCode;
    let fileEscaped = null;
    const isEscaped = () =>
      (fileEscaped ??= sourceCode
        .getAllComments()
        .some(comment => ESCAPE.test(comment.value)));

    function check(node, value) {
      countSite('aria-modal-focus-trap');
      if (allowed || staticallyFalse(value) || isEscaped()) {
        return;
      }
      context.report({ node, messageId: 'handRolled' });
    }

    return {
      JSXAttribute(node) {
        if (
          node.name.type === 'JSXIdentifier' &&
          node.name.name === ATTRIBUTE
        ) {
          // `aria-modal` with no value is `true` in JSX.
          check(node, node.value ?? { type: 'Literal', value: true });
        }
      },
      Property(node) {
        const key = node.key;
        const name =
          key.type === 'Literal'
            ? key.value
            : key.type === 'Identifier' && !node.computed
              ? key.name
              : null;
        if (name === ATTRIBUTE) {
          check(node, node.value);
        }
      },
    };
  },
};

const SHELL = 'src/UI/primitives/AppModalShell.atom.tsx';

export default {
  name: 'aria-modal-focus-trap',
  replaces: 'tests/audit/aria-modal-focus-trap.sh',
  rule,
  blocks: [
    {
      files: ['src/**/*.tsx', 'src/**/*.ts'],
      options: {
        // The canonical home of the attribute: the shell wires trap + restore around it.
        allow: [SHELL],
      },
    },
  ],
  presence: {
    minSites: 3,
    what: 'aria-modal attributes and object keys in main/src',
  },
  paths: [SHELL],
};
