// nf/app-link-only — internal links go through AppLinkAtom; only its own file reaches next/link.
//
// Successor of tests/audit/app-link-only.sh. Why the rule exists:
// next.config.mjs keeps `skipTrailingSlashRedirect: true` (PostHog posts to slashless /ingest),
// so a bare <Link href="/blog"> renders `/blog` and every crawler hop goes through a 301.
// AppLinkAtom adds the slash (application/routing/page-href.ts).
// The grep matched the text `from 'next/link'`; this rule reads every way a module is reached:
// `import … from`, `export … from` (a re-export is a second door), `import('next/link')`,
// `require('next/link')` and the type position `typeof import('next/link')`.
// Escape: `// app-link-allow: <reason>` in a comment of the file (the reason is mandatory).
import { countSite } from '../lib.mjs';
import {
  hasEscapeWithReason,
  matchesAny,
  relativeFile,
  staticString,
} from './_guard-files.mjs';

const MODULE = 'next/link';

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Only AppLinkAtom imports next/link; every other file uses AppLinkAtom.',
    },
    schema: [
      {
        type: 'object',
        properties: { wrapper: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
    messages: {
      bare: 'Reaches next/link directly instead of AppLinkAtom (UI/components/AppLink/AppLink.atom). Deliberate exception: // app-link-allow: <reason>.',
    },
  },
  create(context) {
    const wrapper = context.options[0]?.wrapper ?? [];
    if (matchesAny(relativeFile(context), wrapper)) {
      return {};
    }
    const sourceCode = context.sourceCode;
    let escaped;
    function report(node) {
      escaped ??= hasEscapeWithReason(sourceCode, 'app-link-allow');
      if (!escaped) {
        context.report({ node, messageId: 'bare' });
      }
    }
    function checkSource(node, source) {
      if (staticString(source) === MODULE) {
        report(node);
      }
    }
    return {
      ImportDeclaration(node) {
        // The presence floor: imports of the wrapper itself (the anchor this rule protects).
        if (
          node.specifiers.some(
            s =>
              s.type === 'ImportSpecifier' && s.imported.name === 'AppLinkAtom'
          )
        ) {
          countSite('app-link-only');
        }
        checkSource(node, node.source);
      },
      ExportNamedDeclaration(node) {
        if (node.source) {
          checkSource(node, node.source);
        }
      },
      ExportAllDeclaration(node) {
        checkSource(node, node.source);
      },
      ImportExpression(node) {
        checkSource(node, node.source);
      },
      TSImportType(node) {
        // typescript-eslint 8: `argument` is a TSLiteralType around the string.
        const arg =
          node.argument?.type === 'TSLiteralType'
            ? node.argument.literal
            : node.argument;
        checkSource(node, arg);
      },
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require'
        ) {
          checkSource(node, node.arguments[0]);
        }
      },
    };
  },
};

export default {
  name: 'app-link-only',
  replaces: 'tests/audit/app-link-only.sh',
  rule,
  blocks: [
    {
      files: ['src/**/*.{ts,tsx}'],
      ignores: ['**/*.test.ts', '**/*.test.tsx'],
      options: {
        // The wrapper is the one file that must import next/link.
        wrapper: ['src/UI/components/AppLink/AppLink.atom.tsx'],
      },
    },
  ],
  presence: { minSites: 30, what: 'imports of AppLinkAtom in main/src' },
  paths: ['src/UI/components/AppLink/AppLink.atom.tsx'],
};
