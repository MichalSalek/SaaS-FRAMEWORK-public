// nf/time-literals — millisecond arithmetic for hours and days comes from the kernel TIME constants.
//
// Successor of tests/audit/time-literals.sh. TIME (`@kernel/application/
// constants.config`: MS_PER_MINUTE / MS_PER_HOUR / MS_PER_DAY) is the single source of time-unit
// conversions; consumers write `7 * TIME.MS_PER_DAY`, never `7 * 24 * 60 * 60 * 1000`.
// The grep matched four written orders on ONE line (`24*60*60*1000`, `60*60*1000`, `1000*60*60*24`,
// `1000*60*60`). This rule flattens every multiplication chain in the AST (parentheses, `as`
// casts and line breaks included) and reports a chain whose numeric literal factors contain 60,
// 60 and 1000 in ANY order: the hour (and therefore the day) written by hand. A comment or a
// string that shows the arithmetic is not arithmetic and does not count. Bare 3600000 / 86400000
// stay out on purpose (those numbers are sometimes sizes or counters), exactly as before.
//
// Byte-identical in main/ and web-1/; the workspace is read from its package.json `name`.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countSite, unwrapTs } from '../lib.mjs';

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

const isMul = node =>
  node?.type === 'BinaryExpression' && node.operator === '*';

/** Numeric literal factors of a `*` chain, looking through parentheses and TS wrappers. */
function factors(node, out) {
  const value = unwrapTs(node);
  if (isMul(value)) {
    factors(value.left, out);
    factors(value.right, out);
  } else if (value?.type === 'Literal' && typeof value.value === 'number') {
    out.push(value.value);
  }
  return out;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Hour/day millisecond arithmetic comes from TIME.MS_PER_HOUR / TIME.MS_PER_DAY.',
    },
    schema: [],
    messages: {
      literal:
        "Hand-written time arithmetic `{{text}}`: import { TIME } from '@kernel/application/constants.config' and use TIME.MS_PER_HOUR / TIME.MS_PER_DAY (multiply for N units).",
    },
  },
  create(context) {
    return {
      BinaryExpression(node) {
        if (node.operator !== '*') {
          return;
        }
        // Only the outermost multiplication of a chain is a site.
        let parent = node.parent;
        while (
          parent &&
          parent.type !== 'BinaryExpression' &&
          unwrapTs(parent) !== parent
        ) {
          parent = parent.parent;
        }
        if (isMul(parent)) {
          return;
        }
        countSite('time-literals');
        const numbers = factors(node, []);
        const sixties = numbers.filter(n => n === 60).length;
        if (sixties >= 2 && numbers.includes(1000)) {
          context.report({
            node,
            messageId: 'literal',
            data: {
              text: context.sourceCode.getText(node).replace(/\s+/g, ' '),
            },
          });
        }
      },
    };
  },
};

const IGNORES = {
  main: [
    // generated copy of the kernel, which owns TIME itself
    'src/READONLY-shared-kernel/**',
    // assertions may hold the literal value they check
    '**/*.test.ts',
    '**/*.test.tsx',
  ],
  'web-1': [
    'src/READONLY-shared-kernel/**',
    '**/*.test.ts',
    '**/*.test.tsx',
    // test-only fixtures and helpers, same reason as the test files
    'src/test-utils/**',
    // generated Prisma clients
    'src/prisma/**',
    'src/prisma-app-logs/**',
  ],
};

// Outermost multiplication chains inspected, measured 2026-10-23: main 130, web-1 206.
const PRESENCE = {
  main: { minSites: 90, what: 'multiplication chains in main/src' },
  'web-1': { minSites: 150, what: 'multiplication chains in web-1/src' },
};

const PATHS = {
  main: ['src/READONLY-shared-kernel'],
  'web-1': [
    'src/READONLY-shared-kernel',
    'src/test-utils',
    'src/prisma',
    'src/prisma-app-logs',
  ],
};

export default {
  name: 'time-literals',
  replaces: 'tests/audit/time-literals.sh',
  rule,
  blocks: [{ files: ['src/**/*.{ts,tsx}'], ignores: IGNORES[WORKSPACE] }],
  presence: PRESENCE[WORKSPACE],
  paths: PATHS[WORKSPACE],
};
