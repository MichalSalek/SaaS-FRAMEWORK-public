// nf/database-failure — a caught Prisma failure goes through databaseFailure(operation, error)
// (src/application/errors/error-result.helpers.ts): one idiom that reports the stack and returns
// the canonical failure({ type: 'DATABASE_ERROR', operation }).
//
// Read from the AST:
//   - an object literal `{ type: 'DATABASE_ERROR' }` (any quote, a static template, or a const
//     holding that string) anywhere inside a catch body is reported;
//   - a binding-less `catch {` is covered too (a swallowed error is the worse anti-pattern: it is
//     lost entirely);
//   - a `databaseFailure(` call elsewhere in the same catch does not excuse an inline literal.
// An inline DATABASE_ERROR at function scope (no error in scope) stays allowed.
import { countSite } from '../lib.mjs';
import { propertyKeyName, staticString, variableOf } from './_scope.mjs';

const NAME = 'database-failure';

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Inside a catch, a DB failure is `return databaseFailure('<operation>', error)`, never a hand-rolled DATABASE_ERROR.",
    },
    schema: [
      {
        type: 'object',
        properties: { allow: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
    messages: {
      inline:
        "Hand-rolled DATABASE_ERROR inside a catch: return databaseFailure('<operation>', error) (reports the stack and builds the canonical failure in one place).",
      swallowed:
        "Binding-less `catch {}` builds a DATABASE_ERROR and loses the error: bind it and return databaseFailure('<operation>', error).",
    },
  },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');
    const allow = context.options[0]?.allow ?? [];
    if (
      allow.some(entry => filename === entry || filename.endsWith(`/${entry}`))
    ) {
      return {};
    }
    const sourceCode = context.sourceCode;

    function isDatabaseErrorValue(node) {
      if (staticString(node) === 'DATABASE_ERROR') {
        return true;
      }
      let value = node;
      while (
        value &&
        (value.type === 'TSAsExpression' ||
          value.type === 'TSSatisfiesExpression')
      ) {
        value = value.expression;
      }
      if (staticString(value) === 'DATABASE_ERROR') {
        return true;
      }
      if (value?.type === 'Identifier') {
        const def = variableOf(sourceCode, value)?.defs.find(
          d => d.type === 'Variable'
        );
        const init = def?.node.id.type === 'Identifier' ? def.node.init : null;
        return init ? isDatabaseErrorValue(init) : false;
      }
      return false;
    }

    /**
     * The innermost catch clause whose BODY holds this node, or null. A callback inside the catch
     * still closes over the error, so function boundaries do not stop the walk (the awk did not
     * stop there either).
     */
    function enclosingCatch(node) {
      let current = node.parent;
      while (current) {
        if (current.type === 'CatchClause') {
          return current;
        }
        current = current.parent;
      }
      return null;
    }

    return {
      CatchClause() {
        countSite(NAME);
      },
      Property(node) {
        if (
          node.parent.type !== 'ObjectExpression' ||
          propertyKeyName(node) !== 'type'
        ) {
          return;
        }
        if (!isDatabaseErrorValue(node.value)) {
          return;
        }
        const handler = enclosingCatch(node.parent);
        if (handler) {
          context.report({
            node: node.parent,
            messageId: handler.param ? 'inline' : 'swallowed',
          });
        }
      },
    };
  },
};

export default {
  name: NAME,
  replaces: 'tests/audit/database-failure.sh',
  rule,
  blocks: [
    {
      // Root: web-1/src/domain (the census scope of the old audit), tests excluded as before.
      files: ['src/domain/**/*.{ts,tsx}'],
      ignores: ['**/*.test.ts', '**/*.test.tsx', '**/*.d.ts'],
      options: { allow: [] },
    },
  ],
  presence: { minSites: 250, what: 'catch clauses in web-1/src/domain' },
  paths: ['src/domain', 'src/application/errors/error-result.helpers.ts'],
};
