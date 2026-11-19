// nf/brand-literals — brand identity (domain, deep-link scheme, social handle, android package) comes
// from BRAND_CONFIG (`.shared-kernel/domain/platform/brand.config.ts`), never from a literal.
//
// Successor of the TypeScript half of tests/audit/brand-literals.sh; the JSON
// half and the assetlinks.json parity live in tests/audit/tools/brand.ts (JSON is not ESLint's).
// The grep read lines and skipped only lines that START with `//` or `*`, so a trailing comment
// naming the domain failed the push while the same domain in a multi-line template passed if the
// line began with `*`. This rule reads only VALUES: string literals, template literal chunks, JSX
// text and JSX attribute strings. Comments never count; a string always does.
// Pattern (unchanged): nailfolio.app | nailfolio:// | @nailfolio_app | com.nailfolio.
// The bare name "Nailfolio" is out of scope by design (stable, lives in i18n copy).
//
// Byte-identical in main/, web-1/ and the root `eslint-rules/rules/`; the workspace is read from
// its package.json `name` and selects its own allowlist below.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countSite } from '../lib.mjs';

const WS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);
function detectWorkspace() {
  const pkg = path.join(WS_DIR, 'package.json');
  const name = existsSync(pkg)
    ? JSON.parse(readFileSync(pkg, 'utf8')).name
    : undefined;
  return name === 'main' || name === 'web-1' ? name : 'root';
}
const WORKSPACE = detectWorkspace();

export const BRAND_PATTERN =
  /nailfolio\.app|nailfolio:\/\/|@nailfolio_app|com\.nailfolio/;

const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Brand identity literals come from BRAND_CONFIG.' },
    schema: [],
    messages: {
      literal:
        "Brand literal `{{match}}`: import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config' and use BRAND_CONFIG.* (domain, url, deepLinkScheme, social, androidPackage).",
    },
  },
  create(context) {
    function inspect(node, text) {
      countSite('brand-literals');
      const match = BRAND_PATTERN.exec(text);
      if (match) {
        context.report({
          node,
          messageId: 'literal',
          data: { match: match[0] },
        });
      }
    }
    return {
      Literal(node) {
        if (typeof node.value === 'string') {
          inspect(node, node.value);
        }
      },
      TemplateElement(node) {
        inspect(node, node.value.cooked ?? node.value.raw);
      },
      JSXText(node) {
        inspect(node, node.value);
      },
    };
  },
};

const TESTS = ['**/*.test.ts', '**/*.test.tsx'];

const BLOCKS = {
  main: [
    {
      files: ['src/**/*.{ts,tsx}'],
      ignores: [
        ...TESTS,
        // propagated kernel copy (the source is linted at the root)
        'src/READONLY-shared-kernel/**',
      ],
    },
  ],
  'web-1': [
    {
      files: ['src/**/*.{ts,tsx}'],
      ignores: [
        ...TESTS,
        'src/READONLY-shared-kernel/**',
        // env-driven origin fallback `ENV_VARS.FRONTEND_PUBLIC_DOMAIN || 'nailfolio.app'` (transport, by design)
        'src/application/environment/environment.utils.api.ts',
        // the same env-driven origin fallback for the login token bridge
        'src/application/auth/better-auth/auth-token-bridge.ts',
        // Resend FROM on the Resend-verified domain, a deliberate constant (DECISION above RESEND_FROM)
        'src/application/email-handler/adapters/resend.ts',
      ],
    },
  ],
  root: [
    {
      files: ['.shared-kernel/**/*.ts'],
      ignores: [
        ...TESTS,
        // the SSOT definition itself
        '.shared-kernel/domain/platform/brand.config.ts',
      ],
    },
  ],
};

const PATHS = {
  main: ['src/READONLY-shared-kernel'],
  'web-1': [
    'src/READONLY-shared-kernel',
    'src/application/environment/environment.utils.api.ts',
    'src/application/auth/better-auth/auth-token-bridge.ts',
    'src/application/email-handler/adapters/resend.ts',
  ],
  root: ['.shared-kernel/domain/platform/brand.config.ts'],
};

// String values inspected, measured 2026-10-23: main 46949, web-1 16834, root (kernel) 5839.
const PRESENCE = {
  main: {
    minSites: 35000,
    what: 'string literals, template chunks and JSX text in main/src',
  },
  'web-1': {
    minSites: 12000,
    what: 'string literals and template chunks in web-1/src',
  },
  root: {
    minSites: 4000,
    what: 'string literals and template chunks in .shared-kernel',
  },
};

export default {
  name: 'brand-literals',
  replaces:
    'tests/audit/brand-literals.sh (TS/TSX part; JSON + parity: tests/audit/tools/brand.ts)',
  rule,
  blocks: BLOCKS[WORKSPACE],
  presence: PRESENCE[WORKSPACE],
  paths: PATHS[WORKSPACE],
};
