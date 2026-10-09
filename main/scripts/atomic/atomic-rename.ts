/**
 * atomic-rename.ts — FQC FAZA 1 codemod (ts-morph, dev-time).
 *
 * Input: census mapping JSON (array of { file, fileLayer, exports: [{name, target, layer}] }).
 * Akcja per plik:
 *   1. Dla KAŻDEGO component-export → rename symbolu (name → target) AST-poprawnie
 *      w CAŁYM projekcie (import named, JSX <X>/</X>, typy, re-eksporty).
 *   2. Plik dostaje sufiks warstwy: `X.tsx` → `X.{fileLayer}.tsx` (sub-file zachowuje
 *      marker: `X.parts.tsx` → `X.parts.{fileLayer}.tsx`). sf.move() aktualizuje
 *      WSZYSTKIE import-paths do tego pliku automatycznie (AST, nie sed).
 *   3. Idempotentny: pomija jeśli symbol już == target i plik już ma sufiks.
 *
 * Uruchom: `cd main && npx tsx scripts/atomic/atomic-rename.ts <mapping.json> [--dry]`
 *
 * Bezpieczeństwo: NIE commituje. Po przebiegu uruchom `tsc --noEmit` (martwy ref =
 * błąd typu). LSP bywa stale — autorytatywny jest tsc.
 */
import { Project, Node } from 'ts-morph';
import * as fs from 'fs';
import * as path from 'path';

const LAYER_SUFFIXES = ['atom', 'molecule', 'organism', 'composition'];

type ExportEntry = { name: string; target: string; layer: string; isMain?: boolean };
type FileEntry = { file: string; fileLayer: string; exports: ExportEntry[] };

const mappingPath = process.argv[2];
const dry = process.argv.includes('--dry');
if (!mappingPath) {
  console.error('Usage: atomic-rename.ts <mapping.json> [--dry]');
  process.exit(1);
}
const mapping: FileEntry[] = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));

const project = new Project({ tsConfigFilePath: path.resolve('tsconfig.json') });

let renamedSymbols = 0;
let movedFiles = 0;
const skipped: string[] = [];
const errors: string[] = [];

// ── PASS 1: rename every symbol (must happen before moves, references resolve on current tree).
for (const entry of mapping) {
  const sf = project.getSourceFile(path.resolve(entry.file));
  if (!sf) {
    errors.push(`SOURCE NOT FOUND: ${entry.file}`);
    continue;
  }
  for (const exp of entry.exports) {
    if (exp.name === exp.target) continue;
    // Find the top-level declaration whose name == exp.name.
    let renamed = false;
    for (const decl of [
      ...sf.getFunctions(),
      ...sf.getVariableDeclarations(),
      ...sf.getClasses(),
      ...sf.getInterfaces(),
      ...sf.getTypeAliases(),
    ]) {
      const nameNode = (decl as { getNameNode?: () => Node | undefined }).getNameNode?.();
      if (nameNode && Node.isIdentifier(nameNode) && nameNode.getText() === exp.name) {
        try {
          nameNode.rename(exp.target);
          renamedSymbols++;
          renamed = true;
        } catch (e) {
          errors.push(`RENAME FAIL ${exp.name}→${exp.target} in ${entry.file}: ${(e as Error).message}`);
        }
        break;
      }
    }
    if (!renamed) skipped.push(`${exp.name} (decl not found in ${entry.file})`);
  }
}

if (!dry) project.saveSync();

// ── PASS 2: move/rename files to carry the layer suffix (after symbol renames saved).
for (const entry of mapping) {
  const sf = project.getSourceFile(path.resolve(entry.file));
  if (!sf) continue;
  const dir = path.dirname(entry.file);
  const base = path.basename(entry.file, '.tsx');
  const parts = base.split('.');
  // Already suffixed? (last segment is a layer)
  if (LAYER_SUFFIXES.includes(parts[parts.length - 1])) {
    // re-suffix only if fileLayer differs
    if (parts[parts.length - 1] === entry.fileLayer) continue;
    parts.pop();
  }
  if (!LAYER_SUFFIXES.includes(entry.fileLayer)) {
    errors.push(`BAD fileLayer "${entry.fileLayer}" for ${entry.file}`);
    continue;
  }
  const newBase = [...parts, entry.fileLayer].join('.') + '.tsx';
  const newPath = path.join(dir, newBase);
  if (path.resolve(newPath) === path.resolve(entry.file)) continue;
  try {
    sf.move(path.resolve(newPath));
    movedFiles++;
  } catch (e) {
    errors.push(`MOVE FAIL ${entry.file}→${newBase}: ${(e as Error).message}`);
  }
}

if (!dry) project.saveSync();

console.log(`── atomic-rename ${dry ? '(DRY)' : ''} ──`);
console.log(`renamed symbols: ${renamedSymbols}`);
console.log(`moved files:     ${movedFiles}`);
if (skipped.length) console.log(`skipped (${skipped.length}): ${skipped.slice(0, 8).join('; ')}${skipped.length > 8 ? ' …' : ''}`);
if (errors.length) {
  console.log(`\nERRORS (${errors.length}):`);
  errors.forEach((e) => console.log('  ✗ ' + e));
  process.exit(1);
}
