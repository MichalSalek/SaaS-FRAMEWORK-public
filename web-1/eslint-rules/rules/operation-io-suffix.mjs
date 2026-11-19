// nf/operation-io-suffix — an exported domain operation that returns OperationResult from IO carries
// the `_IO` suffix (e.g. createGalleryRecord_IO): one-glance signal of the domain's IO front door.
//
// Successor of tests/audit/operation-io-suffix.sh. Scope as before: files under
// a domain `operations/` directory or named `*.operations.ts` (flat slices), tests excluded. The awk
// read a 40-line text window after `export const X = async` / `export async function X` and
// looked for the word OperationResult in it. This rule reads the declared type instead:
//   - an exported function (declaration, arrow or function expression; `export { x }` of a local
//     one included) whose RETURN type annotation names OperationResult, or a const whose own type
//     annotation is a function type returning it;
//   - "IO" = async, or a declared `Promise<…>` return. A synchronous OperationResult (a pure
//     validator) is not an IO operation. The awk saw only `async`; a non-async export returning
//     Promise<OperationResult> slipped through it.
// Allowlist: option `allow: ['<workspace-relative path>::<exportName>']` (empty; the old PENDING
// list was empty). A listed entry that no longer matches a violation is reported (stale entry).
import { countSite } from '../lib.mjs';
import { slashed } from './_scope.mjs';

const NAME = 'operation-io-suffix';

function mentionsOperationResult(typeNode) {
  let found = false;
  const visit = node => {
    if (found || !node || typeof node.type !== 'string') {
      return;
    }
    if (
      node.type === 'TSTypeReference' &&
      ((node.typeName.type === 'Identifier' &&
        node.typeName.name === 'OperationResult') ||
        (node.typeName.type === 'TSQualifiedName' &&
          node.typeName.right.name === 'OperationResult'))
    ) {
      found = true;
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === 'parent' || key === 'loc' || key === 'range') {
        continue;
      }
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach(visit);
      } else if (child && typeof child === 'object') {
        visit(child);
      }
    }
  };
  visit(typeNode);
  return found;
}

function isPromiseType(typeNode) {
  return (
    typeNode?.type === 'TSTypeReference' &&
    typeNode.typeName.type === 'Identifier' &&
    typeNode.typeName.name === 'Promise'
  );
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Exported domain operations returning OperationResult from IO end in `_IO`.',
    },
    schema: [
      {
        type: 'object',
        properties: { allow: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
    messages: {
      suffix:
        '`{{name}}` returns OperationResult from IO: rename it `{{name}}_IO` (declaration and every call site).',
      stale:
        'Allowlist entry `{{entry}}` matches no violation any more: remove it.',
    },
  },
  create(context) {
    const filename = slashed(context.filename);
    const allow = (context.options[0]?.allow ?? []).filter(entry => {
      const [file] = entry.split('::');
      return filename === file || filename.endsWith(`/${file}`);
    });
    const allowHit = new Set();
    const sourceCode = context.sourceCode;

    /** Function node + the type annotation on the binding (if any). */
    function check(nameNode, fn, bindingType) {
      if (!fn) {
        return;
      }
      countSite(NAME);
      const returnType = fn.returnType?.typeAnnotation ?? null;
      let declared = returnType;
      if (!declared && bindingType?.type === 'TSFunctionType') {
        declared = bindingType.returnType?.typeAnnotation ?? null;
      }
      if (!declared || !mentionsOperationResult(declared)) {
        return;
      }
      if (!fn.async && !isPromiseType(declared)) {
        return;
      }
      const name = nameNode.name;
      if (name.endsWith('_IO')) {
        return;
      }
      const entry = allow.find(item => item.endsWith(`::${name}`));
      if (entry) {
        allowHit.add(entry);
        return;
      }
      context.report({ node: nameNode, messageId: 'suffix', data: { name } });
    }

    function isFunction(node) {
      return (
        node?.type === 'ArrowFunctionExpression' ||
        node?.type === 'FunctionExpression' ||
        node?.type === 'FunctionDeclaration'
      );
    }

    function checkDeclaration(declaration, exportedName) {
      if (!declaration) {
        return;
      }
      if (declaration.type === 'FunctionDeclaration' && declaration.id) {
        check(exportedName ?? declaration.id, declaration, null);
        return;
      }
      if (declaration.type === 'VariableDeclaration') {
        for (const declarator of declaration.declarations) {
          checkDeclarator(declarator, exportedName);
        }
      }
    }

    function checkDeclarator(declarator, exportedName) {
      if (declarator.id.type !== 'Identifier') {
        return;
      }
      let init = declarator.init;
      while (
        init &&
        (init.type === 'TSAsExpression' ||
          init.type === 'TSSatisfiesExpression')
      ) {
        init = init.expression;
      }
      if (isFunction(init)) {
        check(
          exportedName ?? declarator.id,
          init,
          declarator.id.typeAnnotation?.typeAnnotation
        );
      }
    }

    return {
      ExportNamedDeclaration(node) {
        if (node.declaration) {
          checkDeclaration(node.declaration, null);
          return;
        }
        if (node.source) {
          return;
        }
        // `export { localOp }` / `export { localOp as exportedName }`
        for (const spec of node.specifiers) {
          if (spec.local.type !== 'Identifier' || spec.exportKind === 'type') {
            continue;
          }
          const scope = sourceCode.getScope(node);
          const variable = scope.set.get(spec.local.name);
          const def = variable?.defs[0];
          const exported =
            spec.exported.type === 'Identifier' ? spec.exported : spec.local;
          if (def?.type === 'FunctionName') {
            checkDeclaration(def.node, exported);
          } else if (def?.type === 'Variable') {
            checkDeclarator(def.node, exported);
          }
        }
      },
      'Program:exit'(node) {
        for (const entry of allow) {
          if (!allowHit.has(entry)) {
            context.report({ node, messageId: 'stale', data: { entry } });
          }
        }
      },
    };
  },
};

export default {
  name: NAME,
  replaces: 'tests/audit/operation-io-suffix.sh',
  rule,
  blocks: [
    {
      // Root: web-1/src/domain, operation files discovered by convention (directory or suffix).
      files: [
        'src/domain/**/operations/**/*.ts',
        'src/domain/**/*.operations.ts',
      ],
      ignores: ['**/*.test.ts', '**/*.d.ts'],
      options: { allow: [] },
    },
  ],
  presence: {
    minSites: 350,
    what: 'exported functions in web-1 domain operation files',
  },
  paths: ['src/domain'],
};
