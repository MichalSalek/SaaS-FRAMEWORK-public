// nf/button-primitives — icon actions use <Button>, not a raw <button> styled as an icon action.
//
// `<Button variant='ghost' icon={…} ariaLabel='…'>` (src/UI/components/Button) is the single source
// for icon actions (exemplar: features/admin/components/ColorRow); the drift it prevents is bespoke
// per-feature classes (`*iconButton`, `*actionBtn`) on raw <button> elements.
// Anchor: the raw JSX element `<button>` (lowercase) and every class name its `className` can
// produce, read from the AST (`styles.x`, string and template parts, `clsx`/`cn` arguments and
// keys, conditionals, a same-file `const` alias). A name containing `iconButton`, `iconBtn`,
// `actionBtn` or `actionButton` (case-insensitive) is in the family. The close/dismiss family
// (`closeButton`, `dismissBtn`) is out of scope: overlay chrome that the 44 px ghost Button cannot
// reproduce.
// DECISION: the family is a name PATTERN, not "every icon-only raw <button>": 15+ raw icon-only
// buttons (close X, pin/heart/share on a photo card, layout toggle, cookie tab) are allowed on
// purpose, and pulling them in is a product decision, not a migration.
import { countSite, staticPropertyName, unwrapTs } from '../lib.mjs';

const FAMILY = /(icon(button|btn)|action(btn|button))/i;

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'A raw <button> must not carry an icon-action class (*iconButton, *iconBtn, *actionBtn, *actionButton): use <Button variant="ghost" icon={…} ariaLabel="…">.',
    },
    schema: [
      {
        type: 'object',
        properties: { allow: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
    messages: {
      raw: 'Raw <button> with icon-action class `{{token}}`: use <Button variant="ghost" icon={…} ariaLabel="…"> (exemplar: features/admin/components/ColorRow). A genuinely bespoke button goes on the rule allowlist with a reason.',
    },
  },
  create(context) {
    const allow = context.options[0]?.allow ?? [];
    const filename = context.filename.replaceAll('\\', '/');
    const allowed = allow.some(fragment => filename.endsWith(fragment));
    const sourceCode = context.sourceCode;

    function constInit(identifier) {
      let scope = sourceCode.getScope(identifier);
      while (scope) {
        const variable = scope.set.get(identifier.name);
        if (variable) {
          const def = variable.defs.length === 1 ? variable.defs[0] : null;
          return def?.type === 'Variable' &&
            def.parent?.kind === 'const' &&
            def.node.id.type === 'Identifier'
            ? def.node.init
            : null;
        }
        scope = scope.upper;
      }
      return null;
    }

    /** First class token in the family the expression can produce, or null. */
    function familyToken(node, seen = new Set()) {
      const value = unwrapTs(node);
      if (!value) {
        return null;
      }
      switch (value.type) {
        case 'Literal':
          return typeof value.value === 'string'
            ? (value.value.split(/\s+/).find(token => FAMILY.test(token)) ??
                null)
            : null;
        case 'TemplateLiteral': {
          for (const quasi of value.quasis) {
            const token = quasi.value.cooked
              ?.split(/\s+/)
              .find(part => FAMILY.test(part));
            if (token) {
              return token;
            }
          }
          return firstOf(value.expressions, seen);
        }
        case 'MemberExpression': {
          const name = staticPropertyName(value);
          return name !== null && FAMILY.test(name) ? name : null;
        }
        case 'Identifier': {
          if (seen.has(value.name)) {
            return null;
          }
          seen.add(value.name);
          const init = constInit(value);
          return init ? familyToken(init, seen) : null;
        }
        case 'CallExpression':
          return firstOf(value.arguments, seen);
        case 'ArrayExpression':
          return firstOf(value.elements, seen);
        case 'ObjectExpression':
          // clsx({ [styles.iconBtn]: on, actionBtn: on }): the KEYS are the class names.
          for (const property of value.properties) {
            if (property.type !== 'Property') {
              continue;
            }
            if (!property.computed && property.key.type === 'Identifier') {
              if (FAMILY.test(property.key.name)) {
                return property.key.name;
              }
              continue;
            }
            const token = familyToken(property.key, seen);
            if (token) {
              return token;
            }
          }
          return null;
        case 'ConditionalExpression':
          return firstOf([value.consequent, value.alternate], seen);
        case 'LogicalExpression':
        case 'BinaryExpression':
          return firstOf([value.left, value.right], seen);
        case 'JSXExpressionContainer':
          return familyToken(value.expression, seen);
        default:
          return null;
      }
    }

    function firstOf(nodes, seen) {
      for (const child of nodes) {
        const token = child ? familyToken(child, seen) : null;
        if (token) {
          return token;
        }
      }
      return null;
    }

    return {
      JSXOpeningElement(node) {
        if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'button') {
          return;
        }
        countSite('button-primitives');
        if (allowed) {
          return;
        }
        for (const attribute of node.attributes) {
          if (
            attribute.type !== 'JSXAttribute' ||
            attribute.name.type !== 'JSXIdentifier' ||
            attribute.name.name !== 'className' ||
            !attribute.value
          ) {
            continue;
          }
          const token = familyToken(attribute.value);
          if (token) {
            context.report({
              node: attribute,
              messageId: 'raw',
              data: { token },
            });
          }
        }
      },
    };
  },
};

// Intentional raw icon-action buttons: a bespoke visual identity that <Button variant='ghost'>
// does not reproduce 1:1; each carries a comment in source explaining why it stays raw.
const ALLOW = [
  // .iconButton: spring hover + danger color-mix variant.
  'src/UI/features/salon-staff/StaffMemberCard.organism.tsx',
  // .actionBtn: icon + TEXT moderation actions, semantic per-action colour.
  'src/UI/features/admin/components/ReportCardActions.molecule.tsx',
  // .actionBtn: confirm-step action buttons, same family as ReportCardActions.
  'src/UI/features/admin/components/ReportActionConfirm.molecule.tsx',
];

export default {
  name: 'button-primitives',
  replaces: 'tests/audit/button-primitives.sh',
  rule,
  blocks: [
    {
      files: ['src/UI/**/*.tsx'],
      // Demo surfaces render raw elements on purpose (as in the script).
      ignores: ['src/UI/**/playground/**', 'src/UI/**/ui-library/**'],
      options: { allow: ALLOW },
    },
  ],
  presence: {
    minSites: 60,
    what: 'raw <button> opening elements in main/src/UI',
  },
  paths: [...ALLOW],
};
