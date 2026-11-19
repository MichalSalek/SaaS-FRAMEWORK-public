// nf/secret-discipline — secrets are compared in constant time and governed by the env schema.
//
// Successor of tests/audit/secret-discipline.sh. Two checks:
//   (a) compare: no `===` / `!==` (and, new, `==` / `!=`) between a value and a secret-named
//       operand (an identifier or member name containing "secret", any case, on EITHER side; the
//       grep saw only the left side). A non-constant-time compare leaks the secret byte by byte
//       through timing; the sanctioned compare is crypto.timingSafeEqual behind
//       verifyInternalSecret(). A presence check is not a value compare and is allowed: the other
//       side is `null`, `undefined`, `''`, or either side is a `typeof` expression.
//   (b) governance: every `process.env` read of a variable whose name contains SECRET (any case;
//       `process.env.X`, `process.env['X']`, `const { X } = process.env`) names a variable the env
//       schema registers (`name: 'X'` in env-schema.ts), so no secret escapes the required/format
//       contract and fails open in production. The schema is DATA this rule reads from disk; its
//       path is in `paths`. New: the RAW_VARS registry (environment.config.ts) is checked too:
//       it is the one place secrets are read from process.env, so it is where (b) matters.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { countSite, staticPropertyName } from '../lib.mjs';

const SECRET_RX = /secret/i;
const COMPARE_OPERATORS = new Set(['===', '!==', '==', '!=']);

function unwrap(node) {
  let current = node;
  while (
    current &&
    (current.type === 'TSNonNullExpression' ||
      current.type === 'TSAsExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'ChainExpression')
  ) {
    current = current.expression;
  }
  return current;
}

/** The name an operand reads under: `secret`, `x.secret`, `env.WEBHOOK_SECRET`. */
function operandName(node) {
  const value = unwrap(node);
  if (value?.type === 'Identifier') {
    return value.name;
  }
  if (value?.type === 'MemberExpression') {
    return staticPropertyName(value);
  }
  return null;
}

/** A side that makes the comparison a presence or type check, not a value compare. */
function isPresenceOperand(node) {
  const value = unwrap(node);
  return (
    (value?.type === 'Literal' &&
      (value.value === null || value.value === '')) ||
    (value?.type === 'Identifier' && value.name === 'undefined') ||
    (value?.type === 'TemplateLiteral' &&
      value.expressions.length === 0 &&
      value.quasis[0].value.cooked === '') ||
    (value?.type === 'UnaryExpression' &&
      (value.operator === 'typeof' || value.operator === 'void'))
  );
}

function isProcessEnv(node) {
  const value = unwrap(node);
  return (
    value?.type === 'MemberExpression' &&
    staticPropertyName(value) === 'env' &&
    unwrap(value.object)?.type === 'Identifier' &&
    unwrap(value.object).name === 'process'
  );
}

const schemaCache = new Map();
function registeredNames(schemaPath) {
  if (!schemaCache.has(schemaPath)) {
    let names = null;
    try {
      const text = readFileSync(schemaPath, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      names = new Set(
        [...text.matchAll(/name:\s*'([A-Za-z_][A-Za-z0-9_]*)'/g)].map(m => m[1])
      );
    } catch {
      names = null;
    }
    schemaCache.set(schemaPath, names);
  }
  return schemaCache.get(schemaPath);
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Secrets are compared in constant time and every process.env secret is registered in the env schema.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          envSchema: { type: 'string' },
          compareAllow: { type: 'array', items: { type: 'string' } },
        },
        required: ['envSchema'],
        additionalProperties: false,
      },
    ],
    messages: {
      compare:
        'Non-constant-time compare on secret `{{name}}` (`{{operator}}`): it leaks the secret through timing. Use verifyInternalSecret() / crypto.timingSafeEqual.',
      ungoverned:
        "Ungoverned secret: process.env.{{name}} is not registered in env-schema.ts. Register it (required: 'prod', format: 'secret') and read it through ENV_VARS.",
      noSchema:
        'The env schema {{schema}} cannot be read: secret governance has nothing to check against.',
    },
  },
  create(context) {
    const options = context.options[0];
    const filename = context.filename.replaceAll('\\', '/');
    const compareExempt = (options.compareAllow ?? []).some(fragment =>
      filename.endsWith(fragment)
    );
    const schemaPath = path.isAbsolute(options.envSchema)
      ? options.envSchema
      : path.join(context.cwd, options.envSchema);
    let schemaReported = false;

    function checkEnvName(node, name) {
      countSite('secret-discipline');
      if (name === null || !SECRET_RX.test(name)) {
        return;
      }
      const names = registeredNames(schemaPath);
      if (names === null) {
        if (!schemaReported) {
          schemaReported = true;
          context.report({
            node,
            messageId: 'noSchema',
            data: { schema: options.envSchema },
          });
        }
        return;
      }
      if (!names.has(name)) {
        context.report({ node, messageId: 'ungoverned', data: { name } });
      }
    }

    return {
      BinaryExpression(node) {
        if (!COMPARE_OPERATORS.has(node.operator) || compareExempt) {
          return;
        }
        countSite('secret-discipline');
        if (isPresenceOperand(node.left) || isPresenceOperand(node.right)) {
          return;
        }
        const name = [operandName(node.left), operandName(node.right)].find(
          candidate => candidate !== null && SECRET_RX.test(candidate)
        );
        if (name) {
          context.report({
            node,
            messageId: 'compare',
            data: { name, operator: node.operator },
          });
        }
      },
      MemberExpression(node) {
        if (isProcessEnv(node.object)) {
          checkEnvName(node, staticPropertyName(node));
        }
      },
      VariableDeclarator(node) {
        if (
          node.id.type !== 'ObjectPattern' ||
          !node.init ||
          !isProcessEnv(node.init)
        ) {
          return;
        }
        for (const property of node.id.properties) {
          if (property.type !== 'Property') {
            continue;
          }
          const key =
            !property.computed && property.key.type === 'Identifier'
              ? property.key.name
              : property.key.type === 'Literal'
                ? String(property.key.value)
                : null;
          checkEnvName(property, key);
        }
      },
    };
  },
};

export default {
  name: 'secret-discipline',
  replaces: 'tests/audit/secret-discipline.sh',
  rule,
  blocks: [
    {
      // Root: all of web-1/src (.ts and .tsx, as the old script). Test fixtures use literal
      // secrets; the READONLY kernel copy is a global ignore of the workspace config (linted at
      // its source in the root workspace).
      files: ['src/**/*.{ts,tsx}'],
      ignores: ['**/*.test.ts', '**/*.test.tsx'],
      options: {
        envSchema: 'src/application/environment/env-schema.ts',
        // Exempt from the compare check only (each holds a presence/type guard on a secret by
        // design): the sanctioned timing-safe compare, the schema registry, the RAW_VARS registry.
        compareAllow: [
          'src/application/auth/verify-internal-secret.ts',
          'src/application/environment/env-schema.ts',
          'src/application/environment/environment.config.ts',
        ],
      },
    },
  ],
  presence: {
    minSites: 1700,
    what: 'equality comparisons and process.env reads in web-1/src',
  },
  paths: [
    'src/application/environment/env-schema.ts',
    'src/application/auth/verify-internal-secret.ts',
    'src/application/environment/environment.config.ts',
  ],
};
