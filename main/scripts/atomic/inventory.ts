/**
 * inventory.ts — FQC FAZA 0 census tooling (ts-morph, dev-time, read-only).
 *
 * Deterministyczny przelot KAŻDEGO .tsx w src/UI + src/pages + src/application +
 * src/UI/layouts → dla każdego pliku wypluwa: komponenty-eksporty, czy plik jest
 * komponentem (vs hook/config/helper/typ/test), obecny sufiks warstwy, deps do
 * components/features/primitives, flagi (page/subFile/mainFile/childrenProp).
 *
 * To NIE klasyfikuje warstwy (atom/molecule/...) — to robi census (osąd). Tu =
 * surowy, kompletny, 100%-enumerujący inwentarz, na którym opiera się ratchet
 * (co wymaga sufiksu vs allowlist) i klasyfikacja.
 *
 * Uruchom: `cd main && npx tsx scripts/atomic/inventory.ts [--json]`
 */
import { Project, Node, SyntaxKind } from 'ts-morph';
import * as path from 'path';

const LAYER_SUFFIXES = ['atom', 'molecule', 'organism', 'composition'] as const;
const SUBFILE_MARKERS = ['parts', 'blocks', 'sections', 'actions', 'archive', 'events', 'events-map'];

type FileEntry = {
  file: string;
  area: string;
  isPage: boolean;
  isLayout: boolean;
  isSubFile: boolean;
  isMainFile: boolean;
  isTest: boolean;
  isHookOrConfigName: boolean;
  currentSuffix: string | null;
  componentExports: string[];
  otherExports: string[];
  isComponentFile: boolean;
  componentDeps: string[];
  hasChildrenProp: boolean;
};

const project = new Project({ tsConfigFilePath: path.resolve('tsconfig.json') });

const GLOBS = ['src/UI/**/*.tsx', 'src/pages/**/*.tsx', 'src/application/**/*.tsx'];
const files = project.getSourceFiles(GLOBS);

function isPascalCase(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

function bodyReturnsJsx(node: Node): boolean {
  // Any JSX element/fragment anywhere in the declaration body = component-ish.
  return (
    node.getFirstDescendantByKind(SyntaxKind.JsxElement) !== undefined ||
    node.getFirstDescendantByKind(SyntaxKind.JsxSelfClosingElement) !== undefined ||
    node.getFirstDescendantByKind(SyntaxKind.JsxFragment) !== undefined
  );
}

function exportIsComponent(name: string, decl: Node): boolean {
  if (!isPascalCase(name)) return false;
  if (name.startsWith('use')) return false;
  // forwardRef / memo / styled / Object.assign(Component, ...) wrappers + JSX bodies.
  if (bodyReturnsJsx(decl)) return true;
  const text = decl.getText();
  if (/\b(forwardRef|memo)\s*[(<]/.test(text)) return true;
  if (/Object\.assign\(\s*[A-Z]/.test(text)) return true;
  return false;
}

const entries: FileEntry[] = [];

for (const sf of files) {
  const rel = path.relative('.', sf.getFilePath()).replace(/\\/g, '/');
  if (rel.includes('READONLY-shared-kernel') || rel.includes('node_modules')) continue;

  const base = path.basename(rel).replace(/\.tsx$/, '');
  const dir = path.dirname(rel);
  const folderName = path.basename(dir);

  const isTest = /\.test$/.test(base) || rel.includes('/test-utils/');
  const isPage = rel.startsWith('src/pages/');
  const isLayout = rel.startsWith('src/UI/layouts/');

  // Strip a trailing layer-suffix then a sub-file marker to recover the logical base.
  const parts = base.split('.');
  let currentSuffix: string | null = null;
  if (LAYER_SUFFIXES.includes(parts[parts.length - 1] as never)) {
    currentSuffix = parts.pop()!;
  }
  const isSubFile = parts.some((p) => SUBFILE_MARKERS.includes(p));
  const logicalBase = parts[0];

  const isMainFile = logicalBase === folderName || (!rel.includes('/components/') && parts.length === 1 && !isSubFile);
  const isHookOrConfigName = /^use[A-Z]/.test(base) || /\.(config|helper|helpers|utils|formatters|disambiguation|context|store|seed|types|policy)$/.test(base.replace(/\.(atom|molecule|organism|composition)$/, ''));

  const exported = sf.getExportedDeclarations();
  const componentExports: string[] = [];
  const otherExports: string[] = [];

  for (const [name, decls] of exported) {
    const decl = decls[0];
    if (!decl) continue;
    if (Node.isInterfaceDeclaration(decl) || Node.isTypeAliasDeclaration(decl)) {
      otherExports.push(name);
      continue;
    }
    if (exportIsComponent(name, decl)) componentExports.push(name);
    else otherExports.push(name);
  }

  // Component deps: named imports from components/ primitives/ features/.
  const componentDeps = new Set<string>();
  let hasChildrenProp = false;
  for (const imp of sf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue();
    if (/(components|primitives|features)\//.test(spec)) {
      for (const named of imp.getNamedImports()) {
        const n = named.getName();
        if (isPascalCase(n)) componentDeps.add(n);
      }
    }
  }
  if (/children\s*[?:]/.test(sf.getText()) || /\bchildren\b/.test(sf.getText())) hasChildrenProp = true;

  const area = dir.replace('src/UI/', '').replace('src/', '');

  entries.push({
    file: rel,
    area,
    isPage,
    isLayout,
    isSubFile,
    isMainFile,
    isTest,
    isHookOrConfigName,
    currentSuffix,
    componentExports,
    otherExports,
    isComponentFile: componentExports.length > 0,
    componentDeps: [...componentDeps],
    hasChildrenProp,
  });
}

const asJson = process.argv.includes('--json');
if (asJson) {
  process.stdout.write(JSON.stringify(entries, null, 2));
} else {
  const total = entries.length;
  const compFiles = entries.filter((e) => e.isComponentFile);
  const nonComp = entries.filter((e) => !e.isComponentFile);
  const withSuffix = compFiles.filter((e) => e.currentSuffix !== null);
  const subFiles = entries.filter((e) => e.isSubFile);
  const multiExport = compFiles.filter((e) => e.componentExports.length > 1);
  const totalCompExports = compFiles.reduce((a, e) => a + e.componentExports.length, 0);

  console.log('═══ ATOMIC INVENTORY (FQC FAZA 0) ═══');
  console.log(`Total .tsx (UI+pages+application):  ${total}`);
  console.log(`  component-files:                  ${compFiles.length}`);
  console.log(`  non-component (hook/config/type):  ${nonComp.length}`);
  console.log(`  component-files WITH layer suffix: ${withSuffix.length}`);
  console.log(`  component-files WITHOUT suffix:    ${compFiles.length - withSuffix.length}  ← FAZA 1 target`);
  console.log(`  sub-files (.parts/.blocks/...):    ${subFiles.length}`);
  console.log(`  multi-export component files:      ${multiExport.length}`);
  console.log(`  TOTAL component exports:           ${totalCompExports}`);
  console.log('');
  console.log('── component-files WITHOUT suffix, by area ──');
  const byArea = new Map<string, number>();
  for (const e of compFiles.filter((e) => e.currentSuffix === null)) {
    const top = e.area.split('/').slice(0, 2).join('/');
    byArea.set(top, (byArea.get(top) ?? 0) + 1);
  }
  [...byArea.entries()].sort((a, b) => b[1] - a[1]).forEach(([a, n]) => console.log(`  ${String(n).padStart(3)}  ${a}`));
  console.log('');
  console.log('── multi-export component files (sub-file decomposition) ──');
  multiExport.slice(0, 20).forEach((e) => console.log(`  ${e.componentExports.length}  ${e.file}  [${e.componentExports.join(', ')}]`));
  console.log(`  ... (${multiExport.length} total multi-export files)`);
}
