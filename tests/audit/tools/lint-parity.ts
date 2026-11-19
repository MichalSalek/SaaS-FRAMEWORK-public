// lint-parity — the three copies of the ESLint guard infrastructure stay one implementation.
//
// Each workspace (main, web-1, root) is built and linted standalone, so each carries its own copy
// of `eslint-rules/`. Two kinds of file must stay byte-identical:
//   1. infra: `lib.mjs`, `index.mjs`, `run-guards.mjs` (discovery, floors, path assertions);
//   2. shared rules: a rule module that exists in more than one workspace (`rules/<name>.mjs`,
//      discovered by name, never listed by hand) is the same rule and must be the same bytes.
// A copy that drifts is a guard that silently means something else in one workspace.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  newCheck,
  projectRoot,
  report,
  type CheckResult,
  type MutableCheck,
} from './_lib';

export const WORKSPACES = ['main', 'web-1', '.'] as const;
export const INFRA = ['lib.mjs', 'index.mjs', 'run-guards.mjs'] as const;
/** Shared guards required by all three standalone workspace configurations. */
export const REQUIRED_SHARED = [
  'brand-literals.mjs',
  'import-boundaries.mjs',
] as const;

const rulesDir = (root: string, ws: string): string =>
  path.join(root, ws, 'eslint-rules', 'rules');

function compareCopies(
  check: MutableCheck,
  root: string,
  rel: (ws: string) => string,
  label: string,
  present: readonly string[]
): void {
  const [first, ...rest] = present;
  if (first === undefined) {
    return;
  }
  const reference = readFileSync(path.join(root, rel(first)));
  check.sites += present.length;
  for (const ws of rest) {
    if (!reference.equals(readFileSync(path.join(root, rel(ws))))) {
      check.findings.push({
        file: rel(ws),
        line: 1,
        message: `${label} differs from ${rel(first)}; the copies must be byte-identical`,
      });
    }
  }
}

export function run(root: string): CheckResult[] {
  const infra: MutableCheck = newCheck(
    'lint-parity:infra',
    INFRA.length * WORKSPACES.length,
    'infra copies'
  );
  for (const file of INFRA) {
    const rel = (ws: string): string =>
      path.posix.join(ws, 'eslint-rules', file);
    const present = WORKSPACES.filter(ws =>
      existsSync(path.join(root, rel(ws)))
    );
    for (const ws of WORKSPACES) {
      if (!present.includes(ws)) {
        infra.errors.push(`missing ${rel(ws)}`);
      }
    }
    compareCopies(infra, root, rel, file, present);
  }

  const shared: MutableCheck = newCheck(
    'lint-parity:shared-rules',
    1,
    'copies of shared rules'
  );
  const owners = new Map<string, string[]>();
  for (const ws of WORKSPACES) {
    const dir = rulesDir(root, ws);
    if (!existsSync(dir)) {
      shared.errors.push(
        `missing ${path.posix.join(ws, 'eslint-rules', 'rules')}`
      );
      continue;
    }
    for (const file of readdirSync(dir)) {
      if (
        file.endsWith('.mjs') &&
        !file.endsWith('.test.mjs') &&
        !file.startsWith('_')
      ) {
        owners.set(file, [...(owners.get(file) ?? []), ws]);
      }
    }
  }
  for (const file of REQUIRED_SHARED) {
    const present = owners.get(file) ?? [];
    for (const ws of WORKSPACES) {
      if (!present.includes(ws))
        shared.errors.push(
          `missing ${path.posix.join(ws, 'eslint-rules', 'rules', file)}`
        );
    }
  }
  for (const [file, present] of owners) {
    if (present.length > 1) {
      compareCopies(
        shared,
        root,
        ws => path.posix.join(ws, 'eslint-rules', 'rules', file),
        file,
        present
      );
    }
  }
  return [infra, shared];
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exit(report('lint-parity', run(projectRoot())));
}
