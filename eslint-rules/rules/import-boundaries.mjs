// nf/import-boundaries — module boundaries between the apps, the kernel and inside a workspace.
//
// Reads every MODULE SPECIFIER in the AST (import / export-from / `import()` / `require()` /
// `import x = require()` / `vi.mock()`) and tests both the raw text and the path it resolves to
// (relative, or through the workspace's tsconfig aliases) against the bans of the workspace:
//   - escape:       a relative specifier must not leave its root (an app, or `.shared-kernel`);
//   - cross-module: main never names web-1, web-1 never names main;
//   - readonly:     the kernel never imports its own propagated READONLY copies;
//   - barrel:       `db_models.dto` is not a module, import the generated or manual DTO file;
//   - prisma:       web-1 takes only `Prisma` / `PrismaClient` from the generated js-client;
//   - adapters:     only the email-transport facade imports email-handler/adapters/ (allowlist);
//   - reverse-layer: main `UI/components/**` never imports `UI/features/**` (escape on the line or
//                   above: `// features-import-allow: <reason>`; a bare marker is rejected).
// This file is byte-identical in main/, web-1/ and the root `eslint-rules/rules/`; the workspace is
// read from the `name` in the workspace's package.json and selects its own blocks below.
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

const BARREL = {
  id: 'barrel',
  raw: '(^|/)db_models\\.dto$',
  message:
    '`db_models.dto` barrel: import `db_models.generated.dto` or `db_models.manual.dto` directly.',
};

const ruleSchema = [
  {
    type: 'object',
    properties: {
      aliases: { type: 'object', additionalProperties: { type: 'string' } },
      escapeRoots: { type: 'array', items: { type: 'string' } },
      bans: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            files: { type: 'array', items: { type: 'string' } },
            raw: { type: 'string' },
            resolved: { type: 'string' },
            allowNames: { type: 'array', items: { type: 'string' } },
            allow: { type: 'array', items: { type: 'string' } },
            marker: { type: 'string' },
            message: { type: 'string' },
          },
          required: ['id', 'message'],
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  },
];

const MOCK_CALLEES =
  /^(vi|jest)\.(mock|doMock|unmock|importActual|importMock|requireActual)$/;

function literalText(node) {
  if (!node) {
    return null;
  }
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

const toPosix = value => value.split(path.sep).join('/');

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Module boundaries between the apps, the kernel and the layers of a workspace.',
    },
    schema: ruleSchema,
    messages: {
      escape:
        'Relative import `{{spec}}` leaves `{{root}}` (`.` = the workspace): workspaces are built standalone; share code through .shared-kernel.',
      ban: '{{message}} (`{{spec}}`)',
      bareMarker: '`{{marker}}` needs a reason: `// {{marker}}: <why>`.',
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const cwd = context.cwd;
    const relFile = toPosix(path.relative(cwd, context.filename));
    const relDir = path.posix.dirname(relFile);
    const aliases = Object.entries(options.aliases ?? {});
    const escapeRoot = (options.escapeRoots ?? []).find(
      root => root === '.' || relFile.startsWith(`${root}/`)
    );
    const bans = (options.bans ?? [])
      .filter(
        ban =>
          !ban.files || ban.files.some(prefix => relFile.startsWith(prefix))
      )
      .filter(
        ban =>
          !(ban.allow ?? []).some(allowed =>
            allowed.endsWith('/')
              ? relFile.startsWith(allowed)
              : relFile === allowed
          )
      )
      .map(ban => ({
        ...ban,
        rawRe: ban.raw ? new RegExp(ban.raw) : null,
        resolvedRe: ban.resolved ? new RegExp(ban.resolved) : null,
      }));
    const sourceCode = context.sourceCode;

    /** Workspace-relative path the specifier points at, or null for a package. */
    function resolve(spec) {
      if (
        spec.startsWith('./') ||
        spec.startsWith('../') ||
        spec === '.' ||
        spec === '..'
      ) {
        return path.posix.normalize(path.posix.join(relDir, spec));
      }
      for (const [prefix, target] of aliases) {
        if (spec.startsWith(prefix)) {
          return path.posix.normalize(target + spec.slice(prefix.length));
        }
      }
      return null;
    }

    /** `// <marker>: <reason>` on the specifier's line or the line above the statement. */
    function markerState(marker, specNode, statement) {
      const lines = new Set([
        specNode.loc.start.line,
        statement.loc.start.line - 1,
        statement.loc.start.line,
      ]);
      let state = 'none';
      for (const comment of sourceCode.getAllComments()) {
        if (
          !lines.has(comment.loc.start.line) &&
          !lines.has(comment.loc.end.line)
        ) {
          continue;
        }
        const at = comment.value.indexOf(marker);
        if (at === -1) {
          continue;
        }
        const rest = comment.value.slice(at + marker.length);
        if (/^\s*:\s*\S/.test(rest)) {
          return 'reason';
        }
        state = 'bare';
      }
      return state;
    }

    function check(specNode, statement, importDecl) {
      const spec = literalText(specNode);
      if (spec === null) {
        return;
      }
      countSite('import-boundaries');
      const resolved = resolve(spec);
      const escapes =
        escapeRoot === '.'
          ? resolved === '..' || resolved?.startsWith('../')
          : !`${resolved}/`.startsWith(`${escapeRoot}/`);
      if (
        escapeRoot !== undefined &&
        resolved !== null &&
        spec.startsWith('.') &&
        escapes
      ) {
        context.report({
          node: specNode,
          messageId: 'escape',
          data: { spec, root: escapeRoot },
        });
      }
      for (const ban of bans) {
        const hit =
          (ban.rawRe !== null && ban.rawRe.test(spec)) ||
          (ban.resolvedRe !== null &&
            resolved !== null &&
            ban.resolvedRe.test(resolved));
        if (!hit) {
          continue;
        }
        if (ban.allowNames && importDecl && importDecl.specifiers.length > 0) {
          const onlyAllowed = importDecl.specifiers.every(
            s =>
              s.type === 'ImportSpecifier' &&
              s.imported.type === 'Identifier' &&
              s.local.name === s.imported.name &&
              ban.allowNames.includes(s.imported.name)
          );
          if (onlyAllowed) {
            continue;
          }
        }
        if (ban.marker) {
          const state = markerState(ban.marker, specNode, statement);
          if (state === 'reason') {
            continue;
          }
          if (state === 'bare') {
            context.report({
              node: specNode,
              messageId: 'bareMarker',
              data: { marker: ban.marker },
            });
            continue;
          }
        }
        context.report({
          node: specNode,
          messageId: 'ban',
          data: { message: ban.message, spec },
        });
      }
    }

    return {
      ImportDeclaration(node) {
        check(node.source, node, node);
      },
      ExportNamedDeclaration(node) {
        if (node.source) {
          check(node.source, node, null);
        }
      },
      ExportAllDeclaration(node) {
        check(node.source, node, null);
      },
      ImportExpression(node) {
        check(node.source, node, null);
      },
      TSImportType(node) {
        // `source` (typescript-eslint 8.x) replaces the deprecated `argument`.
        const target = 'source' in node ? node.source : node.argument;
        check(
          target?.type === 'TSLiteralType' ? target.literal : target,
          node,
          null
        );
      },
      TSExternalModuleReference(node) {
        check(node.expression, node.parent ?? node, null);
      },
      CallExpression(node) {
        const callee = node.callee;
        const name =
          callee.type === 'Identifier'
            ? callee.name
            : callee.type === 'MemberExpression' &&
                !callee.computed &&
                callee.object.type === 'Identifier'
              ? `${callee.object.name}.${callee.property.name}`
              : null;
        if (name === 'require' || (name !== null && MOCK_CALLEES.test(name))) {
          check(node.arguments[0], node, null);
        }
      },
    };
  },
};

export const BLOCKS = {
  main: [
    {
      files: ['src/**/*.{ts,tsx}'],
      ignores: ['src/READONLY-shared-kernel/**'],
      options: {
        aliases: { '@kernel/': 'src/READONLY-shared-kernel/' },
        escapeRoots: ['.'],
        bans: [
          {
            id: 'cross-module',
            raw: 'web-1',
            message:
              'main must not import from web-1: share code through .shared-kernel.',
          },
          BARREL,
          {
            id: 'reverse-layer',
            files: ['src/UI/components/'],
            raw: '(^|[^A-Za-z0-9_])features/',
            resolved: '^src/UI/features(/|$)',
            marker: 'features-import-allow',
            message:
              'UI/components/ is the layer BELOW features: move the file to UI/features/ or the shared piece to components/.',
          },
        ],
      },
    },
  ],
  'web-1': [
    {
      files: ['src/**/*.{ts,tsx}'],
      ignores: [
        'src/READONLY-shared-kernel/**',
        'src/prisma/js-client/**',
        'src/prisma-app-logs/js-client/**',
      ],
      options: {
        aliases: {
          '@kernel/': 'src/READONLY-shared-kernel/',
          '@app/': 'src/application/',
          '@domain/': 'src/domain/',
        },
        escapeRoots: ['.'],
        bans: [
          {
            id: 'cross-module',
            raw: '/main/',
            message:
              'web-1 must not import from main: share code through .shared-kernel.',
          },
          BARREL,
          {
            id: 'prisma',
            raw: 'prisma/js-client',
            allowNames: ['Prisma', 'PrismaClient'],
            message:
              'Only `Prisma` / `PrismaClient` come from the generated js-client (named, unaliased); enums and models come from the kernel.',
          },
          {
            id: 'adapters',
            resolved: '^src/application/email-handler/adapters/',
            allow: [
              // the facade itself: the one sanctioned entry into the transports
              'src/application/email-handler/email-transport.ts',
              // Better Auth's magic-link hook is wired straight to its adapter (the shell guard's baseline of 1)
              'src/application/auth/better-auth/better-auth.config.ts',
              // the transports themselves import each other
              'src/application/email-handler/adapters/',
            ],
            message:
              'Email transports are reached through the email-transport facade, not adapters/ directly.',
          },
        ],
      },
    },
  ],
  root: [
    {
      files: ['.shared-kernel/**/*.ts'],
      options: {
        escapeRoots: ['.shared-kernel'],
        bans: [
          {
            id: 'readonly',
            raw: 'READONLY',
            message:
              'The kernel must not import its own propagated READONLY copy.',
          },
          BARREL,
        ],
      },
    },
  ],
};

const PATHS = {
  main: ['src/UI/components', 'src/UI/features', 'src/READONLY-shared-kernel'],
  'web-1': [
    'src/application/email-handler/adapters',
    'src/application/email-handler/email-transport.ts',
    'src/application/auth/better-auth/better-auth.config.ts',
    'src/prisma',
  ],
  root: ['.shared-kernel'],
};

// Module specifiers inspected, measured 2026-10-23: main 9175, web-1 7669, root (kernel) 546.
const PRESENCE = {
  main: { minSites: 7000, what: 'module specifiers in main/src' },
  'web-1': { minSites: 6000, what: 'module specifiers in web-1/src' },
  root: { minSites: 400, what: 'module specifiers in .shared-kernel' },
};

export default {
  name: 'import-boundaries',
  replaces: 'tests/audit/imports-health.sh',
  rule,
  blocks: BLOCKS[WORKSPACE],
  presence: PRESENCE[WORKSPACE],
  paths: PATHS[WORKSPACE],
};
