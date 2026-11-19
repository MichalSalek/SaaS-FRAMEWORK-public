// nf/atomic-coverage — a UI component file carries its layer on the file and the export.
//
// Successor of tests/audit/atomic-coverage.sh. Every component under src/UI is
// `*.atom|molecule|organism|composition.tsx` and exports a name with that Pascal suffix.
// Hooks, configs and the explicit allowlist are not components. The shell's grep also
// matched the suffix inside a comment; this rule reads export declarations only.
import ts from 'typescript';
import { countSite } from '../lib.mjs';
import { matchesAny, relativeFile } from './_guard-files.mjs';

const LAYERS = ['atom', 'molecule', 'organism', 'composition'];
const NONCOMPONENT =
  /\.(config|helper|helpers|utils|formatters|disambiguation|context|store|seed|policy|types|test|events-map|playground)\.tsx$|(^|\/)use[A-Z][A-Za-z0-9]*\.tsx$/;

const ALLOWLIST = [
  'src/UI/components/AppDrawer/appDrawerSections.tsx',
  'src/UI/components/AppDrawer/appDrawerSections.admin.tsx',
  'src/UI/components/Button/buttonCore.tsx',
  'src/UI/features/account/UserActivityPage.events.tsx',
  'src/UI/features/static/GetAppPageFeatures.tsx',
];

function layerOf(rel) {
  const match = rel.match(/\.(atom|molecule|organism|composition)\.tsx$/);
  return match ? match[1] : null;
}

function pascal(layer) {
  return layer.charAt(0).toUpperCase() + layer.slice(1);
}

function hasExport(node) {
  return (ts.getModifiers(node) ?? []).some(
    modifier => modifier.kind === ts.SyntaxKind.ExportKeyword
  );
}

/** Exported names of a component file. Comments and strings are not exports. */
export function exportedNames(text, fileName) {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const names = [];
  const visit = node => {
    if (
      ts.isExportDeclaration(node) &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
    ) {
      for (const element of node.exportClause.elements) {
        names.push(element.name.text);
        if (element.propertyName) {
          names.push(element.propertyName.text);
        }
      }
    }
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name &&
      hasExport(node)
    ) {
      names.push(node.name.text);
    }
    if (ts.isVariableStatement(node) && hasExport(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          names.push(decl.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

/**
 * Layer check for one UI file. `skip` is a non-component or an allowlisted path.
 * @returns {'skip' | 'missing' | 'mismatch' | 'ok'}
 */
export function classifyComponent(rel, text) {
  const base = rel.split('/').pop() ?? rel;
  if (NONCOMPONENT.test(base) || matchesAny(rel, ALLOWLIST)) {
    return 'skip';
  }
  const layer = layerOf(rel);
  if (!layer) {
    return 'missing';
  }
  const suffix = pascal(layer);
  const names = exportedNames(text, base);
  return names.some(name => name.endsWith(suffix)) ? 'ok' : 'mismatch';
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'A UI component file and its export carry the atomic layer suffix.',
    },
    schema: [],
    messages: {
      missing: 'Component file has no layer suffix ({{layers}}).',
      mismatch: 'File is .{{layer}} but no export name ends with {{suffix}}.',
    },
  },
  create(context) {
    return {
      Program(node) {
        const rel = relativeFile(context);
        const text = context.sourceCode.getText();
        const verdict = classifyComponent(rel, text);
        if (verdict === 'skip') {
          return;
        }
        const names = exportedNames(text, rel);
        const inspected = names.length === 0 ? 1 : names.length;
        for (let i = 0; i < inspected; i += 1) {
          countSite('atomic-coverage');
        }
        if (verdict === 'missing') {
          context.report({
            node,
            messageId: 'missing',
            data: { layers: LAYERS.join('|') },
          });
          return;
        }
        if (verdict === 'mismatch') {
          const layer = layerOf(rel) ?? '';
          context.report({
            node,
            messageId: 'mismatch',
            data: { layer, suffix: pascal(layer) },
          });
        }
      },
    };
  },
};

export default {
  name: 'atomic-coverage',
  replaces: 'tests/audit/atomic-coverage.sh',
  rule,
  blocks: [{ files: ['src/UI/**/*.tsx'] }],
  presence: {
    minSites: 650,
    what: 'exported names inspected on UI component files',
  },
  paths: ALLOWLIST,
};
