// nf/storage-adapter-only — device storage goes through the storage adapter, keys through
// STORAGE_KEYS (application/client-device-storage/storage-keys.config.ts). Two invariants:
//   1. no raw Web Storage call (`getItem` / `setItem` / `removeItem`, plus `key` and `clear`) on
//      localStorage / sessionStorage outside the adapter: bare, through `window.` / `globalThis.` /
//      `self.`, in bracket form, and through a local alias (`const s = window.localStorage`);
//   2. a key defined in the SSOT config is never re-hardcoded as a string literal: an exact key
//      (`'cookie-consent-v1'`) or any literal/template starting with a per-entity prefix (a key
//      ending in `:`). The key set is READ from the config, never listed here.
// 'theme' and 'mode' are skipped in 2: they collide with unrelated identifiers and union members,
// and both consumers import the same constant. String literals are read ON PURPOSE in 2 (a
// hardcoded key IS a string), and in 1 for code that ships as a string: a pre-hydration inline
// script body runs as real code, so `localStorage.getItem(` inside a string counts too, outside the
// inline-script allowlist (`inlineScriptAllow`).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import tseslint from 'typescript-eslint';
import { countSite, staticPropertyName, unwrapTs } from '../lib.mjs';
import { matchesAny, relativeFile, staticString } from './_guard-files.mjs';

const STORAGES = new Set(['localStorage', 'sessionStorage']);
const GLOBALS = new Set(['window', 'globalThis', 'self']);
const METHODS = new Set(['getItem', 'setItem', 'removeItem', 'key', 'clear']);
const SKIP_KEYS = new Set(['theme', 'mode']);
const RAW_IN_STRING =
  /\b(localStorage|sessionStorage)\s*\.\s*(getItem|setItem|removeItem|clear|key)\s*\(/;

const keyCache = new Map();

/** Every string value of an object-literal property in the config file. */
function readKeys(file) {
  if (keyCache.has(file)) {
    return keyCache.get(file);
  }
  const { ast } = tseslint.parser.parseForESLint(readFileSync(file, 'utf8'), {
    ecmaVersion: 'latest',
    sourceType: 'module',
  });
  const keys = [];
  const visit = node => {
    if (!node || typeof node.type !== 'string') {
      return;
    }
    if (node.type === 'Property') {
      const value = staticString(unwrapTs(node.value));
      if (value !== null) {
        keys.push(value);
      }
    }
    for (const [field, child] of Object.entries(node)) {
      if (field === 'parent') {
        continue;
      }
      if (Array.isArray(child)) {
        child.forEach(visit);
      } else if (child && typeof child === 'object') {
        visit(child);
      }
    }
  };
  visit(ast);
  const result = {
    exact: new Set(keys.filter(k => !k.endsWith(':') && !SKIP_KEYS.has(k))),
    prefixes: keys.filter(k => k.endsWith(':')),
  };
  keyCache.set(file, result);
  return result;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Web Storage only through the adapter; storage keys only from STORAGE_KEYS.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          config: { type: 'string' },
          allow: { type: 'array', items: { type: 'string' } },
          inlineScriptAllow: { type: 'array', items: { type: 'string' } },
        },
        required: ['config'],
        additionalProperties: false,
      },
    ],
    messages: {
      rawAccess:
        'Raw {{storage}}.{{method}}(): go through the clientStorage adapter (application/client-device-storage) with a key from STORAGE_KEYS.',
      rawInString:
        'Raw Web Storage call inside a string (inline script): only the allowlisted pre-hydration scripts may do that; keep key names SSOT through JSON.stringify(STORAGE_KEYS.*).',
      keyLiteral:
        "Storage key '{{key}}' hardcoded: import it from STORAGE_KEYS (or the key builder) in storage-keys.config.ts.",
    },
  },
  create(context) {
    const { config, allow = [], inlineScriptAllow = [] } = context.options[0];
    const rel = relativeFile(context);
    if (rel === config || matchesAny(rel, allow)) {
      return {};
    }
    const checkInlineScripts = !matchesAny(rel, inlineScriptAllow);
    const keys = readKeys(path.resolve(context.cwd, config));
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

    /** Name of the storage the expression denotes ('localStorage' | 'sessionStorage') or null. */
    function storageOf(node, seen = new Set()) {
      const value = unwrapTs(node);
      if (value?.type === 'Identifier') {
        const variable = variableOf(value);
        if (!variable || variable.defs.length === 0) {
          return STORAGES.has(value.name) ? value.name : null;
        }
        if (seen.has(variable)) {
          return null;
        }
        seen.add(variable);
        for (const def of variable.defs) {
          if (
            def.type === 'Variable' &&
            def.node.id.type === 'Identifier' &&
            def.node.init
          ) {
            const found = storageOf(def.node.init, seen);
            if (found) {
              return found;
            }
          }
        }
        return null;
      }
      if (value?.type === 'MemberExpression') {
        const name = staticPropertyName(value);
        const object = unwrapTs(value.object);
        if (
          STORAGES.has(name) &&
          object?.type === 'Identifier' &&
          GLOBALS.has(object.name)
        ) {
          return name;
        }
      }
      return null;
    }

    function checkLiteral(node, text) {
      countSite('storage-adapter-only');
      if (checkInlineScripts && RAW_IN_STRING.test(text)) {
        context.report({ node, messageId: 'rawInString' });
      }
      if (keys.exact.has(text)) {
        context.report({ node, messageId: 'keyLiteral', data: { key: text } });
        return;
      }
      const prefix = keys.prefixes.find(p => text.startsWith(p));
      if (prefix) {
        context.report({
          node,
          messageId: 'keyLiteral',
          data: { key: prefix },
        });
      }
    }

    return {
      MemberExpression(node) {
        const method = staticPropertyName(node);
        if (!METHODS.has(method)) {
          return;
        }
        const storage = storageOf(node.object);
        if (storage) {
          context.report({
            node,
            messageId: 'rawAccess',
            data: { storage, method },
          });
        }
      },
      Literal(node) {
        if (typeof node.value === 'string') {
          checkLiteral(node, node.value);
        }
      },
      TemplateLiteral(node) {
        checkLiteral(node, node.quasis[0].value.cooked ?? '');
        if (checkInlineScripts) {
          for (const quasi of node.quasis.slice(1)) {
            if (RAW_IN_STRING.test(quasi.value.cooked ?? '')) {
              context.report({ node, messageId: 'rawInString' });
              return;
            }
          }
        }
      },
    };
  },
};

export default {
  name: 'storage-adapter-only',
  replaces: 'tests/audit/storage-keys.sh',
  rule,
  blocks: [
    {
      files: ['src/**/*.{ts,tsx}'],
      // Characterization tests seed and clear storage directly.
      ignores: ['**/*.test.ts', '**/*.test.tsx'],
      options: {
        config: 'src/application/client-device-storage/storage-keys.config.ts',
        allow: [
          // The adapter, its api, the SSOT config and the zero-flash bridge script
          // (zero-flash-script.ts, inlined by _document.tsx; it reads raw storage before hydration).
          'src/application/client-device-storage/',
          // Internal native-shell detection keys (kernel-owned escape hatch, not user state).
          'src/application/platform/platform.detection.ts',
        ],
        inlineScriptAllow: [
          // Consent Mode default: must be the first dataLayer entry; key is
          // JSON.stringify(STORAGE_KEYS.COOKIE_CONSENT).
          'src/application/analytics/consent-default-script.ts',
        ],
      },
    },
  ],
  presence: {
    minSites: 25000,
    what: 'string literals and templates checked against the SSOT storage keys in main/src',
  },
  paths: [
    'src/application/client-device-storage/storage-keys.config.ts',
    'src/application/client-device-storage/',
    'src/application/platform/platform.detection.ts',
    'src/application/analytics/consent-default-script.ts',
  ],
};
