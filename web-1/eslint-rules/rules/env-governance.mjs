// nf/env-governance — web-1 reads app configuration through ENV_VARS only:
// environment.config.ts (RAW_VARS) → env-schema.ts (ENV_SCHEMA validation) → ENV_VARS.
//   A. No raw environment read outside the registry. The rule follows the env OBJECT, so it sees
//      `process['env']`, `process.env?.X`, `const { env } = process`, `const e = process.env; e.X`,
//      `import { env } from 'node:process'`, `globalThis.process.env`, writes and a dynamic
//      `process.env[name]`. Passing the whole env object anywhere is reported too, except a spread
//      into an object literal (`{ ...process.env }`, child-process forwarding in
//      startup/smoke-tests-runner.ts). Var allowlist (platform built-ins): NODE_ENV, NEXT_RUNTIME,
//      VERCEL, PPID. File allowlist: environment.config.ts (the registry).
//   B. RAW_VARS keys and ENV_SCHEMA names are the same set, checked whenever either file is linted
//      (the other is parsed from disk); each drift is reported once, in the file that has the
//      name. A missing RAW_VARS / ENV_SCHEMA anchor is reported instead of passing over nothing.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import tseslint from 'typescript-eslint';
import { countSite, staticPropertyName, unwrapTs } from '../lib.mjs';
import {
  isAllowedFile,
  propertyKeyName,
  slashed,
  staticString,
  variableOf,
} from './_scope.mjs';

const NAME = 'env-governance';
const CONFIG_FILE = 'src/application/environment/environment.config.ts';
const SCHEMA_FILE = 'src/application/environment/env-schema.ts';
const ALLOWED_VARS = new Set(['NODE_ENV', 'NEXT_RUNTIME', 'VERCEL', 'PPID']);
const PROCESS_MODULES = new Set(['process', 'node:process']);

function stripExpression(node) {
  let current = node;
  while (
    current &&
    (current.type === 'TSAsExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'TSNonNullExpression' ||
      current.type === 'TSTypeAssertion')
  ) {
    current = current.expression;
  }
  return current;
}

/** RAW_VARS keys from a Program AST: [{ name, node }] or null when the anchor is missing. */
function rawVarKeys(program) {
  for (const statement of program.body) {
    const declaration =
      statement.type === 'ExportNamedDeclaration'
        ? statement.declaration
        : statement;
    if (declaration?.type !== 'VariableDeclaration') {
      continue;
    }
    for (const declarator of declaration.declarations) {
      if (
        declarator.id.type === 'Identifier' &&
        declarator.id.name === 'RAW_VARS'
      ) {
        const object = stripExpression(declarator.init);
        if (object?.type !== 'ObjectExpression') {
          return null;
        }
        return object.properties
          .map(property => ({
            name: propertyKeyName(property),
            node: property,
          }))
          .filter(entry => entry.name !== null);
      }
    }
  }
  return null;
}

/** ENV_SCHEMA `name:` values from a Program AST, or null when the anchor is missing. */
function schemaNames(program) {
  for (const statement of program.body) {
    const declaration =
      statement.type === 'ExportNamedDeclaration'
        ? statement.declaration
        : statement;
    if (declaration?.type !== 'VariableDeclaration') {
      continue;
    }
    for (const declarator of declaration.declarations) {
      if (
        declarator.id.type === 'Identifier' &&
        declarator.id.name === 'ENV_SCHEMA'
      ) {
        const array = stripExpression(declarator.init);
        if (array?.type !== 'ArrayExpression') {
          return null;
        }
        const names = [];
        for (const element of array.elements) {
          const object = stripExpression(element);
          if (object?.type !== 'ObjectExpression') {
            continue;
          }
          const nameProperty = object.properties.find(
            property => propertyKeyName(property) === 'name'
          );
          const name = nameProperty ? staticString(nameProperty.value) : null;
          if (name !== null) {
            names.push({ name, node: nameProperty });
          }
        }
        return names;
      }
    }
  }
  return null;
}

function parseFile(file) {
  const code = readFileSync(file, 'utf8');
  return tseslint.parser.parseForESLint(code, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    range: true,
    loc: true,
  }).ast;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'No raw environment reads outside environment.config.ts: read ENV_VARS. RAW_VARS and ENV_SCHEMA list the same names.',
    },
    schema: [
      {
        type: 'object',
        properties: { allow: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
    messages: {
      raw: 'Raw `process.env.{{name}}`: read ENV_VARS.{{name}} (register it in environment.config.ts + env-schema.ts).',
      dynamic:
        'Dynamic `process.env[…]` read: the variable cannot be governed; read ENV_VARS.',
      escape:
        'The whole `process.env` object leaves this expression ungoverned: read single values through ENV_VARS (a `{ ...process.env }` spread is the one allowed whole-object form).',
      ungoverned:
        '{{name}} is in RAW_VARS but missing from ENV_SCHEMA (env-schema.ts): no required/format contract.',
      orphaned:
        '{{name}} is in ENV_SCHEMA but missing from RAW_VARS (environment.config.ts): it validates `undefined`.',
      anchor:
        '{{what}} not found in {{file}}: the RAW_VARS ↔ ENV_SCHEMA parity check has nothing to compare.',
    },
  },
  create(context) {
    const filename = slashed(context.filename);
    const allow = context.options[0]?.allow ?? [];
    const sourceCode = context.sourceCode;
    const isConfig =
      filename.endsWith(`/${CONFIG_FILE}`) || filename === CONFIG_FILE;
    const isSchema =
      filename.endsWith(`/${SCHEMA_FILE}`) || filename === SCHEMA_FILE;
    const readsAllowed = isAllowedFile(filename, allow);

    /** The `process` object: the global, `globalThis.process`, an import of node:process, an alias. */
    function isProcess(node, seen = new Set()) {
      const value = unwrapTs(node);
      if (!value) {
        return false;
      }
      if (value.type === 'MemberExpression') {
        const object = unwrapTs(value.object);
        return (
          staticPropertyName(value) === 'process' &&
          object?.type === 'Identifier' &&
          (object.name === 'globalThis' || object.name === 'global') &&
          variableOf(sourceCode, object) === null
        );
      }
      if (value.type !== 'Identifier') {
        return false;
      }
      const variable = variableOf(sourceCode, value);
      if (variable === null) {
        return value.name === 'process';
      }
      if (seen.has(variable)) {
        return false;
      }
      seen.add(variable);
      const def = variable.defs[0];
      if (def.type === 'ImportBinding') {
        return (
          PROCESS_MODULES.has(def.parent.source.value) &&
          (def.node.type === 'ImportDefaultSpecifier' ||
            def.node.type === 'ImportNamespaceSpecifier')
        );
      }
      if (
        def.type === 'Variable' &&
        def.node.id.type === 'Identifier' &&
        def.node.init
      ) {
        return isProcess(def.node.init, seen);
      }
      return false;
    }

    /** Checks one place where the env OBJECT is used. */
    function checkEnvUse(node, seen) {
      countSite(NAME);
      let child = node;
      let parent = node.parent;
      while (
        parent &&
        (parent.type === 'TSAsExpression' ||
          parent.type === 'TSSatisfiesExpression' ||
          parent.type === 'TSNonNullExpression' ||
          parent.type === 'TSTypeAssertion' ||
          parent.type === 'ChainExpression')
      ) {
        child = parent;
        parent = parent.parent;
      }
      if (parent?.type === 'MemberExpression' && parent.object === child) {
        const name = staticPropertyName(parent);
        if (name === null) {
          report(parent, 'dynamic', {});
        } else if (!ALLOWED_VARS.has(name)) {
          report(parent, 'raw', { name });
        }
        return;
      }
      if (
        parent?.type === 'SpreadElement' &&
        parent.parent?.type === 'ObjectExpression'
      ) {
        return;
      }
      if (parent?.type === 'UnaryExpression' && parent.operator === 'typeof') {
        return;
      }
      if (parent?.type === 'VariableDeclarator' && parent.init === child) {
        checkEnvPattern(parent.id, seen);
        return;
      }
      report(node, 'escape', {});
    }

    /** A binding pattern that receives the env object. */
    function checkEnvPattern(pattern, seen) {
      if (pattern.type === 'Identifier') {
        const variable = variableOf(sourceCode, pattern);
        if (!variable || seen.has(variable)) {
          return;
        }
        seen.add(variable);
        for (const reference of variable.references) {
          if (reference.isRead()) {
            checkEnvUse(reference.identifier, seen);
          }
        }
        return;
      }
      if (pattern.type === 'ObjectPattern') {
        for (const property of pattern.properties) {
          if (property.type === 'RestElement') {
            report(property, 'escape', {});
            continue;
          }
          const name = propertyKeyName(property);
          countSite(NAME);
          if (name === null) {
            report(property, 'dynamic', {});
          } else if (!ALLOWED_VARS.has(name)) {
            report(property, 'raw', { name });
          }
        }
        return;
      }
      report(pattern, 'escape', {});
    }

    function report(node, messageId, data) {
      if (!readsAllowed) {
        context.report({ node, messageId, data });
      }
    }

    function checkParity(program) {
      const workspace = filename.slice(
        0,
        filename.length - (isConfig ? CONFIG_FILE : SCHEMA_FILE).length
      );
      const otherFile = path.join(
        workspace,
        isConfig ? SCHEMA_FILE : CONFIG_FILE
      );
      let otherProgram;
      try {
        otherProgram = parseFile(otherFile);
      } catch {
        context.report({
          node: program,
          messageId: 'anchor',
          data: {
            what: isConfig ? 'ENV_SCHEMA' : 'RAW_VARS',
            file: isConfig ? SCHEMA_FILE : CONFIG_FILE,
          },
        });
        return;
      }
      const raw = isConfig ? rawVarKeys(program) : rawVarKeys(otherProgram);
      const schema = isConfig
        ? schemaNames(otherProgram)
        : schemaNames(program);
      if (raw === null || schema === null) {
        context.report({
          node: program,
          messageId: 'anchor',
          data: {
            what:
              raw === null
                ? 'const RAW_VARS = { … }'
                : 'const ENV_SCHEMA = [ … ]',
            file: raw === null ? CONFIG_FILE : SCHEMA_FILE,
          },
        });
        return;
      }
      const rawNames = new Set(raw.map(entry => entry.name));
      const schemaSet = new Set(schema.map(entry => entry.name));
      if (isConfig) {
        for (const entry of raw) {
          countSite(NAME);
          if (!schemaSet.has(entry.name)) {
            context.report({
              node: entry.node,
              messageId: 'ungoverned',
              data: { name: entry.name },
            });
          }
        }
      } else {
        for (const entry of schema) {
          countSite(NAME);
          if (!rawNames.has(entry.name)) {
            context.report({
              node: entry.node,
              messageId: 'orphaned',
              data: { name: entry.name },
            });
          }
        }
      }
    }

    return {
      MemberExpression(node) {
        if (staticPropertyName(node) === 'env' && isProcess(node.object)) {
          checkEnvUse(node, new Set());
        }
      },
      // `const { env } = process` / `const { env: e } = process`
      VariableDeclarator(node) {
        if (
          node.id.type !== 'ObjectPattern' ||
          !node.init ||
          !isProcess(node.init)
        ) {
          return;
        }
        for (const property of node.id.properties) {
          if (
            property.type === 'Property' &&
            propertyKeyName(property) === 'env'
          ) {
            checkEnvPattern(property.value, new Set());
          }
        }
      },
      // `import { env } from 'node:process'`
      ImportDeclaration(node) {
        if (!PROCESS_MODULES.has(node.source.value)) {
          return;
        }
        for (const spec of node.specifiers) {
          const imported =
            spec.type === 'ImportSpecifier' ? spec.imported : null;
          const name = imported
            ? imported.type === 'Identifier'
              ? imported.name
              : imported.value
            : null;
          if (name === 'env') {
            checkEnvPattern(spec.local, new Set());
          }
        }
      },
      'Program:exit'(program) {
        if (isConfig || isSchema) {
          checkParity(program);
        }
      },
    };
  },
};

export default {
  name: NAME,
  replaces: 'tests/audit/env-governance.sh',
  rule,
  blocks: [
    {
      // Root: all of web-1/src (generated clients and the vendored kernel are global ignores).
      files: ['src/**/*.{ts,tsx}'],
      options: {
        // The registry itself: the ONLY place raw process.env is read for app config.
        allow: [CONFIG_FILE],
      },
    },
  ],
  presence: {
    minSites: 150,
    what: 'process.env uses and RAW_VARS/ENV_SCHEMA names in web-1/src',
  },
  paths: [CONFIG_FILE, SCHEMA_FILE],
};
