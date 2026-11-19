// nf/layout-consistency — a page shell stays thin: the feature component mounts its own layout.
//
// Successor of tests/audit/layout-consistency.sh. Canon: UI_ARCHITECTURE.md
// §Layout ("who carries the layout"). Two invariants, both kept:
//   1. No file under src/pages/** imports a layout primitive. The script matched a NAMED import of
//      four hand-listed names (AppLayout|PublicLayout|AdminLayout|AdminPageLayout + suffix) from a
//      path containing `layouts/`. This rule DISCOVERS the primitives from the layouts root
//      (every `src/UI/layouts/*Layout.composition.tsx`, so AccountWebLayout is in without anyone
//      remembering it) and reports any import of such a module — named, default, namespace,
//      type-only, `export … from` and dynamic `import()` — plus a named import of a discovered
//      name from any `layouts/` path. Other modules of src/UI/layouts (NavigationTransition…,
//      LeaveGuardDialog, ImpersonationBanner in _app.tsx) stay legal, as before.
//   2. No Next.js per-page `getLayout` convention anywhere in src: an identifier, a property key or
//      a member named `getLayout` in CODE. The script grepped the raw text, so a comment saying
//      "we do not use getLayout" failed it; prose and strings no longer count.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countSite, staticPropertyName } from '../lib.mjs';

const WORKSPACE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);
const LAYOUTS_DIR = 'src/UI/layouts';
const PAGES_ROOT = 'src/pages/';
const LAYOUTS_SEGMENT = /(^|\/)layouts(\/|$)/;
const PRIMITIVE_FILE = /^([A-Za-z]+Layout)\.composition\.tsx$/;

/** Layout primitives discovered from the layouts root: `AppLayout`, `PublicLayout`, … */
const PRIMITIVES = readdirSync(path.join(WORKSPACE, LAYOUTS_DIR))
  .map(file => PRIMITIVE_FILE.exec(file)?.[1])
  .filter(Boolean);
if (PRIMITIVES.length === 0) {
  // An empty discovery would make the name pattern match everything (or nothing): fail loudly.
  throw new Error(
    `nf/layout-consistency: no *Layout.composition.tsx found in ${LAYOUTS_DIR}`
  );
}

const PRIMITIVE_NAME = new RegExp(`^(${PRIMITIVES.join('|')})\\w*$`);

function isPrimitiveModule(source) {
  if (typeof source !== 'string' || !LAYOUTS_SEGMENT.test(source)) {
    return false;
  }
  const base = source
    .split('/')
    .pop()
    .replace(/\.(tsx?|jsx?)$/, '');
  return PRIMITIVES.some(
    name => base === name || base === `${name}.composition`
  );
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Page shells do not import a layout primitive and nothing uses the getLayout per-page-layout convention.',
    },
    schema: [],
    messages: {
      pageImportsLayout:
        'Page shell imports the layout primitive `{{what}}`: move the layout into the feature component this page renders; the shell keeps getStaticProps + <PublicSeoHead> + <JsonLd>.',
      getLayout:
        '`getLayout` per-page layouts are not used here: the feature component renders its own layout (UI_ARCHITECTURE.md §Layout).',
    },
  },
  create(context) {
    const filename = path
      .relative(WORKSPACE, path.resolve(WORKSPACE, context.filename))
      .replaceAll('\\', '/');
    const isPage = filename.startsWith(PAGES_ROOT);

    function checkSource(node, sourceNode, specifiers = []) {
      if (!isPage) {
        return;
      }
      countSite('layout-consistency');
      const source = sourceNode?.type === 'Literal' ? sourceNode.value : null;
      if (isPrimitiveModule(source)) {
        context.report({
          node,
          messageId: 'pageImportsLayout',
          data: { what: source },
        });
        return;
      }
      if (typeof source !== 'string' || !LAYOUTS_SEGMENT.test(source)) {
        return;
      }
      for (const specifier of specifiers) {
        const imported = specifier.imported ?? specifier.local;
        const name =
          imported?.type === 'Identifier' ? imported.name : imported?.value;
        if (typeof name === 'string' && PRIMITIVE_NAME.test(name)) {
          context.report({
            node,
            messageId: 'pageImportsLayout',
            data: { what: name },
          });
          return;
        }
      }
    }

    function reportGetLayout(node) {
      context.report({ node, messageId: 'getLayout' });
    }

    return {
      ImportDeclaration(node) {
        checkSource(node, node.source, node.specifiers);
      },
      ExportNamedDeclaration(node) {
        if (node.source) {
          checkSource(node, node.source, node.specifiers);
        }
      },
      ExportAllDeclaration(node) {
        checkSource(node, node.source);
      },
      ImportExpression(node) {
        checkSource(node, node.source);
      },
      Identifier(node) {
        if (node.name === 'getLayout') {
          reportGetLayout(node);
        }
      },
      MemberExpression(node) {
        if (node.computed && staticPropertyName(node) === 'getLayout') {
          reportGetLayout(node);
        }
      },
      Property(node) {
        if (
          node.computed === false &&
          node.key.type === 'Literal' &&
          node.key.value === 'getLayout'
        ) {
          reportGetLayout(node);
        }
      },
      TSPropertySignature(node) {
        if (node.key.type === 'Literal' && node.key.value === 'getLayout') {
          reportGetLayout(node);
        }
      },
    };
  },
};

export default {
  name: 'layout-consistency',
  replaces: 'tests/audit/layout-consistency.sh',
  rule,
  blocks: [{ files: ['src/**/*.ts', 'src/**/*.tsx'] }],
  presence: {
    minSites: 450,
    what: 'import/export-from/import() statements in main/src/pages',
  },
  paths: [LAYOUTS_DIR, PAGES_ROOT],
};
