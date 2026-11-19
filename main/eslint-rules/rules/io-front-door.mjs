// nf/io-front-door — backend calls are declared only through the promise-first front door
// (defineEndpoint / defineQuery / definePathEndpoint in application/http/io.ts).
//
// Successor of tests/audit/io-layer.sh. Three invariants, one rule:
//   1. the deleted factories (createIOFunction, createEndpointIO, createQueryIOFunction,
//      createPathParamIOFunction) appear nowhere in main/src as code (any identifier);
//   2. no `toPromise(...)` call in UI/** or domain/** outside the raw-callback allowlist; the
//      call is found through import aliases (`import { toPromise as p }`), local aliases
//      (`const p = toPromise`) and member calls (`io.toPromise(...)`), which the grep missed;
//   3. UI/** never imports ENDPOINTS or createIOFunction (transport belongs to domain /
//      application), in any import or re-export form, multi-line included (the grep read one line).
// Comments and string contents are prose and never count.
import { countSite, unwrapTs } from '../lib.mjs';
import { matchesAny, relativeFile } from './_guard-files.mjs';

const FACTORIES = new Set([
  'createIOFunction',
  'createEndpointIO',
  'createQueryIOFunction',
  'createPathParamIOFunction',
]);
const UI_FORBIDDEN_IMPORTS = new Set(['ENDPOINTS', 'createIOFunction']);

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Backend calls only through defineEndpoint / defineQuery / definePathEndpoint.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          toPromiseRoots: { type: 'array', items: { type: 'string' } },
          toPromiseAllow: { type: 'array', items: { type: 'string' } },
          uiRoots: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      factory:
        '`{{name}}` is a deleted IO factory: declare the call with defineEndpoint / defineQuery / definePathEndpoint (application/http/io.ts).',
      toPromise:
        '`toPromise(...)` call outside the raw-callback allowlist: the front door already returns a Promise, drop the wrapper.',
      uiImport:
        'UI imports the transport primitive `{{name}}`: move the IO into domain/** and import its _IO function.',
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const rel = relativeFile(context);
    const checkToPromise =
      matchesAny(rel, options.toPromiseRoots ?? []) &&
      !matchesAny(rel, options.toPromiseAllow ?? []);
    const checkUiImports = matchesAny(rel, options.uiRoots ?? []);
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

    /** True when the identifier is `toPromise` itself or an alias of it (import or const). */
    function isToPromise(identifier, seen = new Set()) {
      const variable = variableOf(identifier);
      if (!variable) {
        return identifier.name === 'toPromise';
      }
      if (seen.has(variable)) {
        return false;
      }
      seen.add(variable);
      for (const def of variable.defs) {
        if (def.type === 'ImportBinding') {
          const spec = def.node;
          if (spec.type === 'ImportSpecifier') {
            const imported =
              spec.imported.type === 'Identifier'
                ? spec.imported.name
                : spec.imported.value;
            return imported === 'toPromise';
          }
          return false;
        }
        if (
          def.type === 'Variable' &&
          def.node.id.type === 'Identifier' &&
          def.node.init
        ) {
          const init = unwrapTs(def.node.init);
          if (init?.type === 'Identifier') {
            return isToPromise(init, seen);
          }
          if (
            init?.type === 'MemberExpression' &&
            !init.computed &&
            init.property.name === 'toPromise'
          ) {
            return true;
          }
        }
      }
      return identifier.name === 'toPromise';
    }

    function importedName(spec) {
      if (spec.type === 'ImportSpecifier') {
        return spec.imported.type === 'Identifier'
          ? spec.imported.name
          : spec.imported.value;
      }
      if (spec.type === 'ExportSpecifier') {
        return spec.local.type === 'Identifier'
          ? spec.local.name
          : spec.local.value;
      }
      return null;
    }

    function checkImportSpecifiers(node) {
      if (!checkUiImports) {
        return;
      }
      countSite('io-front-door');
      for (const spec of node.specifiers ?? []) {
        const name = importedName(spec);
        if (name && UI_FORBIDDEN_IMPORTS.has(name)) {
          context.report({ node: spec, messageId: 'uiImport', data: { name } });
        }
      }
    }

    return {
      Identifier(node) {
        if (FACTORIES.has(node.name)) {
          context.report({
            node,
            messageId: 'factory',
            data: { name: node.name },
          });
        }
      },
      ImportDeclaration: checkImportSpecifiers,
      ExportNamedDeclaration(node) {
        if (node.source) {
          checkImportSpecifiers(node);
        }
      },
      CallExpression(node) {
        if (!checkToPromise) {
          return;
        }
        countSite('io-front-door');
        const callee = unwrapTs(node.callee);
        const hit =
          (callee?.type === 'Identifier' && isToPromise(callee)) ||
          (callee?.type === 'MemberExpression' &&
            !callee.computed &&
            callee.property.name === 'toPromise');
        if (hit) {
          context.report({ node, messageId: 'toPromise' });
        }
      },
    };
  },
};

export default {
  name: 'io-front-door',
  replaces: 'tests/audit/io-layer.sh',
  rule,
  blocks: [
    {
      // Tests included on purpose, like the grep: a test reaching for a deleted factory is drift too.
      files: ['src/**/*.{ts,tsx}'],
      options: {
        toPromiseRoots: ['src/UI/', 'src/domain/'],
        toPromiseAllow: [
          // Raw-callback IO exceptions: a precisely ordered successCallback (DECISION in each file).
          'src/UI/features/admin/hooks/useBecomeUser.ts',
          'src/UI/features/admin/hooks/useSwitchBackBecomeUser.ts',
        ],
        uiRoots: ['src/UI/'],
      },
    },
  ],
  presence: {
    minSites: 25000,
    what: 'calls in UI/domain and import/re-export declarations in UI/ inspected',
  },
  paths: [
    'src/UI/',
    'src/domain/',
    'src/UI/features/admin/hooks/useBecomeUser.ts',
    'src/UI/features/admin/hooks/useSwitchBackBecomeUser.ts',
  ],
};
