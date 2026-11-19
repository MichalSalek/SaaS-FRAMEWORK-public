// nf/import-aliases — application/ and domain/ are reached through @app/* and @domain/*, never
// through a deep relative path.
//
// Successor of tests/audit/import-aliases.sh. The grep matched the TEXT
// `from|import( '../../(application|domain)/` on one line. This rule reads every module specifier
// (import / export … from / import() / require() / `import x = require()` / `import('…')` types /
// vi.mock-family calls) and flags a relative specifier with two or more `..` steps when either
//   - its text names `application/` or `domain/` right after the `..` steps (the grep's shape), or
//   - it RESOLVES into src/application/ or src/domain/ (e.g. `../../gallery/x` from inside
//     domain/, which the grep could not see).
// One `..` step (a sibling module) stays allowed, as before. A built-in `no-restricted-imports`
// cannot resolve paths, and that rule name is already configured for src/application/** in
// eslint.config.mjs (a second block would replace it), so this is its own rule.
import path from 'node:path';
import { countSite } from '../lib.mjs';
import { slashed, staticString } from './_scope.mjs';

const NAME = 'import-aliases';
const TEXT_SHAPE = /^(\.\/)?(\.\.\/){2,}(application|domain)\//;
const DEEP = /^(\.\/)?(\.\.\/){2,}/;
const MOCK_CALLS = new Set([
  'mock',
  'doMock',
  'unmock',
  'doUnmock',
  'importActual',
  'importMock',
]);

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'No deep relative import into src/application or src/domain: use the @app/* or @domain/* alias.',
    },
    schema: [],
    messages: {
      deep: "Deep relative import into {{area}}/ ('{{source}}'): use the @{{alias}}/* alias.",
    },
  },
  create(context) {
    const filename = slashed(context.filename);
    const srcAt = filename.lastIndexOf('/src/');

    function check(node, source) {
      if (typeof source !== 'string' || !source.startsWith('.')) {
        return;
      }
      countSite(NAME);
      if (!DEEP.test(source)) {
        return;
      }
      let area = TEXT_SHAPE.exec(source)?.[3] ?? null;
      if (!area && srcAt !== -1) {
        const srcRoot = filename.slice(0, srcAt + 4);
        const resolved = slashed(
          path.posix.resolve(path.posix.dirname(filename), source)
        );
        const rel = resolved.startsWith(`${srcRoot}/`)
          ? resolved.slice(srcRoot.length + 1)
          : null;
        area = rel?.match(/^(application|domain)(\/|$)/)?.[1] ?? null;
      }
      if (area) {
        context.report({
          node,
          messageId: 'deep',
          data: {
            area,
            source,
            alias: area === 'application' ? 'app' : 'domain',
          },
        });
      }
    }

    return {
      ImportDeclaration(node) {
        check(node.source, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source) {
          check(node.source, node.source.value);
        }
      },
      ExportAllDeclaration(node) {
        check(node.source, node.source.value);
      },
      ImportExpression(node) {
        check(node.source, staticString(node.source));
      },
      TSImportType(node) {
        // typescript-eslint 8 exposes the specifier as `source` (`argument` is deprecated).
        const argument = node.source ?? node.argument;
        const literal =
          argument?.type === 'TSLiteralType' ? argument.literal : argument;
        check(node, staticString(literal));
      },
      TSExternalModuleReference(node) {
        check(node, staticString(node.expression));
      },
      CallExpression(node) {
        const first = node.arguments[0];
        if (!first) {
          return;
        }
        const callee = node.callee;
        if (callee.type === 'Identifier' && callee.name === 'require') {
          check(first, staticString(first));
          return;
        }
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          (callee.object.name === 'vi' || callee.object.name === 'jest') &&
          !callee.computed &&
          MOCK_CALLS.has(callee.property.name)
        ) {
          check(first, staticString(first));
        }
      },
    };
  },
};

export default {
  name: NAME,
  replaces: 'tests/audit/import-aliases.sh',
  rule,
  blocks: [
    {
      // Root: all of web-1/src; the vendored kernel copy is a global ignore (own relative graph).
      files: ['src/**/*.{ts,tsx}'],
    },
  ],
  presence: { minSites: 1100, what: 'relative module specifiers in web-1/src' },
  paths: ['src/application', 'src/domain'],
};
