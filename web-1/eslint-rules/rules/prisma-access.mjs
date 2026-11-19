// nf/prisma-access — direct Prisma through ONE client (decision D1, see src/application/db/db.client.ts).
//
// Successor of tests/audit/prisma-access.sh. Sub-invariants:
//   1. `new PrismaClient(…)` only in the adapter. The grep matched the text `new PrismaClient(`;
//      this rule resolves the constructor, so `import { PrismaClient as X }` + `new X()`,
//      `const C = PrismaClient`, `new client.PrismaClient()` and a namespace import are seen too.
//   2. no RUNTIME import of PrismaClient from a generated client outside the adapter (type-only
//      imports are fine: they carry no runtime). The grep matched one-line `import { … }` only;
//      this rule also sees multi-line imports, `export { PrismaClient } from`, a runtime namespace
//      import of the client (`import * as C`), `require()` and `import()` of the client module.
//      A specifier written `{ type PrismaClient }` is type-only and allowed (the grep flagged it).
//   3. src/infrastructure/ must not exist (no repository layer). Reported on any file inside it,
//      and — for a directory without lintable files — on the adapter, which is always linted.
//   4. (new) the adapter module is imported only by db.client.ts: everything else reads DB_CLIENT.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { countSite, unwrapTs } from '../lib.mjs';
import { isPrismaClientModule } from './_prisma.mjs';
import {
  propertyKeyName,
  slashed,
  staticString,
  variableOf,
} from './_scope.mjs';

const NAME = 'prisma-access';
const ADAPTER = 'src/application/db/adapters/prisma.adapter.ts';
const DB_CLIENT_FILE = 'src/application/db/db.client.ts';
const INFRA_DIR = 'src/infrastructure';

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'PrismaClient is constructed and imported only by the adapter; everything else goes through DB_CLIENT (@app/db/db.client).',
    },
    schema: [],
    messages: {
      construct:
        '`new {{what}}()` outside {{adapter}}: use DB_CLIENT from @app/db/db.client (one client, one pool).',
      runtimeImport:
        'Runtime import of the Prisma client ({{what}}) outside the adapter: use DB_CLIENT from @app/db/db.client. `import type { Prisma }` is fine.',
      adapterImport:
        'The Prisma adapter is imported only by {{dbClient}}: read DB_CLIENT from @app/db/db.client.',
      infrastructure:
        'src/infrastructure/ must not exist (decision D1: no repository layer). Use DB_CLIENT.use.<model> in domain operations.',
    },
  },
  create(context) {
    const filename = slashed(context.filename);
    if (filename.endsWith('.d.ts')) {
      return {};
    }
    const isAdapter = filename.endsWith(`/${ADAPTER}`) || filename === ADAPTER;
    const isDbClient =
      filename.endsWith(`/${DB_CLIENT_FILE}`) || filename === DB_CLIENT_FILE;
    const sourceCode = context.sourceCode;

    function importOf(identifier) {
      const variable = variableOf(sourceCode, identifier);
      const def = variable?.defs.find(d => d.type === 'ImportBinding');
      if (!def) {
        return null;
      }
      const spec = def.node;
      let imported = '*';
      if (spec.type === 'ImportSpecifier') {
        imported =
          spec.imported.type === 'Identifier'
            ? spec.imported.name
            : spec.imported.value;
      } else if (spec.type === 'ImportDefaultSpecifier') {
        imported = 'default';
      }
      return { source: def.parent.source.value, imported };
    }

    /** Is `node` the PrismaClient class? Returns a label or null. */
    function prismaClientClass(node, seen = new Set()) {
      const value = unwrapTs(node);
      if (!value) {
        return null;
      }
      if (value.type === 'MemberExpression') {
        const property = value.computed
          ? staticString(value.property)
          : value.property.name;
        return property === 'PrismaClient' ? 'x.PrismaClient' : null;
      }
      if (value.type !== 'Identifier' || seen.has(value.name)) {
        return null;
      }
      seen.add(value.name);
      const imported = importOf(value);
      if (imported) {
        return imported.imported === 'PrismaClient'
          ? `PrismaClient as ${value.name}`
          : null;
      }
      const variable = variableOf(sourceCode, value);
      const def = variable?.defs.find(d => d.type === 'Variable');
      if (def?.node.init) {
        if (def.node.id.type === 'Identifier') {
          return prismaClientClass(def.node.init, seen);
        }
        const property =
          def.name.parent?.type === 'Property' ? def.name.parent : null;
        return property && propertyKeyName(property) === 'PrismaClient'
          ? 'PrismaClient'
          : null;
      }
      // Undeclared global of that name: the grep read it by name.
      return variable === null && value.name === 'PrismaClient'
        ? 'PrismaClient'
        : null;
    }

    /** Does a module specifier point at the adapter module? */
    function isAdapterModule(source) {
      if (typeof source !== 'string') {
        return false;
      }
      if (source === '@app/db/adapters/prisma.adapter') {
        return true;
      }
      if (!source.startsWith('.')) {
        return false;
      }
      const resolved = slashed(
        path.resolve(path.dirname(context.filename), source)
      );
      return /\/src\/application\/db\/adapters\/prisma\.adapter(\.ts)?$/.test(
        resolved
      );
    }

    function checkModuleSource(node, source, typeOnly, specifiers) {
      countSite(NAME);
      if (isAdapter) {
        return;
      }
      if (isAdapterModule(source) && !isDbClient && !typeOnly) {
        context.report({
          node,
          messageId: 'adapterImport',
          data: { dbClient: DB_CLIENT_FILE },
        });
        return;
      }
      if (!isPrismaClientModule(source) || typeOnly) {
        return;
      }
      if (specifiers === null) {
        context.report({
          node,
          messageId: 'runtimeImport',
          data: { what: `module ${source}` },
        });
        return;
      }
      for (const spec of specifiers) {
        if (spec.importKind === 'type' || spec.exportKind === 'type') {
          continue;
        }
        if (
          spec.type === 'ImportNamespaceSpecifier' ||
          spec.type === 'ImportDefaultSpecifier'
        ) {
          context.report({
            node: spec,
            messageId: 'runtimeImport',
            data: { what: `* from ${source}` },
          });
          continue;
        }
        const imported =
          spec.type === 'ExportSpecifier' ? spec.local : spec.imported;
        const name =
          imported.type === 'Identifier' ? imported.name : imported.value;
        if (name === 'PrismaClient') {
          context.report({
            node: spec,
            messageId: 'runtimeImport',
            data: { what: 'PrismaClient' },
          });
        }
      }
    }

    return {
      Program(node) {
        const rel = filename.includes('/src/')
          ? `src/${filename.split('/src/').slice(1).join('/src/')}`
          : filename;
        if (rel.startsWith(`${INFRA_DIR}/`)) {
          context.report({ node, messageId: 'infrastructure' });
        }
        if (isAdapter) {
          const workspace = filename.slice(0, filename.length - ADAPTER.length);
          if (existsSync(path.join(workspace, INFRA_DIR))) {
            context.report({ node, messageId: 'infrastructure' });
          }
        }
      },
      NewExpression(node) {
        countSite(NAME);
        if (isAdapter) {
          return;
        }
        const what = prismaClientClass(node.callee);
        if (what) {
          context.report({
            node,
            messageId: 'construct',
            data: { what, adapter: ADAPTER },
          });
        }
      },
      ImportDeclaration(node) {
        checkModuleSource(
          node,
          node.source.value,
          node.importKind === 'type',
          node.specifiers
        );
      },
      ExportNamedDeclaration(node) {
        if (node.source) {
          checkModuleSource(
            node,
            node.source.value,
            node.exportKind === 'type',
            node.specifiers
          );
        }
      },
      ExportAllDeclaration(node) {
        checkModuleSource(
          node,
          node.source.value,
          node.exportKind === 'type',
          null
        );
      },
      ImportExpression(node) {
        checkModuleSource(node, staticString(node.source), false, null);
      },
      TSImportEqualsDeclaration(node) {
        if (node.moduleReference.type === 'TSExternalModuleReference') {
          checkModuleSource(
            node,
            staticString(node.moduleReference.expression),
            node.importKind === 'type',
            null
          );
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments.length > 0
        ) {
          checkModuleSource(node, staticString(node.arguments[0]), false, null);
        }
      },
    };
  },
};

export default {
  name: NAME,
  replaces: 'tests/audit/prisma-access.sh',
  rule,
  blocks: [
    {
      // Root: all of web-1/src (generated clients and the vendored kernel are global ignores).
      files: ['src/**/*.{ts,tsx}'],
    },
  ],
  presence: {
    minSites: 7000,
    what: 'constructor calls and module imports in web-1/src',
  },
  paths: [ADAPTER, DB_CLIENT_FILE],
};
