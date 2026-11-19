// nf/raw-timestamp-interpolation — a wire timestamp (`*_at`, an ISO string) is formatted before it
// reaches a translation.
//
// Successor of tests/audit/raw-timestamp-interpolation.sh. Messages use plain interpolation
// ("Sparowano {date}"), so `t('pairedAt', { date: stylist.paired_at })` renders the literal
// "2026-06-15T10:30:00.000Z". The rule reads the call itself:
//   - every translator, not only one named `t`: an identifier bound to `useTranslations(...)` /
//     `getTranslations(...)` (any name), `t` / `tSomething` (props and params), a `.t` member, and
//     `.rich` / `.markup` on any of them;
//   - every value of the interpolation object (the message interpolates them all);
//   - the raw field behind `?.`, `!`, `as`, `?? ''`, a conditional branch, a template literal or a
//     same-file `const` alias. A call anywhere in the value means a formatter ran.
// A raw value is an identifier or a static member whose name ends in `_at` (the wire DTO
// convention). Escape: a comment `raw-timestamp-allow: <reason>` on the line of that property;
// a bare marker without a reason does not count.
import { countSite, staticPropertyName, unwrapTs } from '../lib.mjs';

const TRANSLATOR_NAME = /^t([A-Z]\w*)?$/;
const TRANSLATOR_FACTORY =
  /^(useTranslations|getTranslations|createTranslator)$/;
const RICH_MEMBER = /^(rich|markup|raw)$/;
const WIRE_TIMESTAMP = /_at$/;
const ESCAPE = /raw-timestamp-allow:\s*\S/;

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'A wire `*_at` ISO timestamp is formatted (formatDate & co.) before it is interpolated into a translation.',
    },
    schema: [],
    messages: {
      raw: 'Raw wire timestamp `{{field}}` interpolated into a translation: format it first, e.g. `formatDate({{field}}, locale)` (application/date/date.utils.ts). Deliberate exception: `// raw-timestamp-allow: <reason>` on this line.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

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

    /** The single `const x = <init>` initialiser of an identifier, or null. */
    function constInit(identifier) {
      const variable = variableOf(identifier);
      const def = variable?.defs.length === 1 ? variable.defs[0] : null;
      if (
        def?.type === 'Variable' &&
        def.parent?.kind === 'const' &&
        def.node.id.type === 'Identifier' &&
        def.node.init
      ) {
        return def.node.init;
      }
      return null;
    }

    function isFactoryCall(node) {
      let value = unwrapTs(node);
      if (value?.type === 'AwaitExpression') {
        value = unwrapTs(value.argument);
      }
      return (
        value?.type === 'CallExpression' &&
        value.callee.type === 'Identifier' &&
        TRANSLATOR_FACTORY.test(value.callee.name)
      );
    }

    function isTranslator(callee) {
      const value = unwrapTs(callee);
      if (value?.type === 'Identifier') {
        if (TRANSLATOR_NAME.test(value.name)) {
          return true;
        }
        const init = constInit(value);
        return init !== null && isFactoryCall(init);
      }
      if (value?.type === 'MemberExpression') {
        const name = staticPropertyName(value);
        if (name === 't') {
          return true;
        }
        return (
          name !== null && RICH_MEMBER.test(name) && isTranslator(value.object)
        );
      }
      return false;
    }

    function containsCall(node) {
      let found = false;
      const visit = current => {
        if (found || !current || typeof current.type !== 'string') {
          return;
        }
        if (
          current.type === 'CallExpression' ||
          current.type === 'NewExpression'
        ) {
          found = true;
          return;
        }
        for (const key of sourceCode.visitorKeys[current.type] ?? []) {
          const child = current[key];
          if (Array.isArray(child)) {
            child.forEach(visit);
          } else {
            visit(child);
          }
        }
      };
      visit(node);
      return found;
    }

    /** Name of the raw wire field the value renders, or null. */
    function rawField(node, seen = new Set()) {
      const value = unwrapTs(node);
      if (!value) {
        return null;
      }
      switch (value.type) {
        case 'Identifier': {
          if (WIRE_TIMESTAMP.test(value.name)) {
            return value.name;
          }
          const init = constInit(value);
          if (init && !seen.has(value.name)) {
            seen.add(value.name);
            return containsCall(init) ? null : rawField(init, seen);
          }
          return null;
        }
        case 'MemberExpression': {
          const name = staticPropertyName(value);
          return name !== null && WIRE_TIMESTAMP.test(name)
            ? sourceCode.getText(value)
            : null;
        }
        case 'LogicalExpression':
          return rawField(value.left, seen) ?? rawField(value.right, seen);
        case 'ConditionalExpression':
          return (
            rawField(value.consequent, seen) ?? rawField(value.alternate, seen)
          );
        case 'TemplateLiteral':
          for (const expression of value.expressions) {
            const field = rawField(expression, seen);
            if (field) {
              return field;
            }
          }
          return null;
        default:
          return null;
      }
    }

    function escaped(property) {
      const line = property.loc.start.line;
      return sourceCode
        .getAllComments()
        .some(
          comment =>
            (comment.loc.start.line === line ||
              comment.loc.end.line === line) &&
            ESCAPE.test(comment.value)
        );
    }

    return {
      CallExpression(node) {
        if (!isTranslator(node.callee)) {
          return;
        }
        for (const argument of node.arguments) {
          const values = unwrapTs(argument);
          if (values?.type !== 'ObjectExpression') {
            continue;
          }
          for (const property of values.properties) {
            if (property.type !== 'Property') {
              continue;
            }
            countSite('raw-timestamp-interpolation');
            const valueNode = property.shorthand
              ? property.key
              : property.value;
            if (containsCall(valueNode)) {
              continue;
            }
            const field = rawField(valueNode);
            if (field && !escaped(property)) {
              context.report({
                node: property,
                messageId: 'raw',
                data: { field },
              });
            }
          }
        }
      },
    };
  },
};

export default {
  name: 'raw-timestamp-interpolation',
  replaces: 'tests/audit/raw-timestamp-interpolation.sh',
  rule,
  blocks: [
    {
      files: ['src/**/*.ts', 'src/**/*.tsx'],
      ignores: ['**/*.test.*', '**/*.spec.*'],
    },
  ],
  presence: {
    minSites: 400,
    what: 'interpolation-object properties passed to a translator in main/src',
  },
  paths: [],
};
