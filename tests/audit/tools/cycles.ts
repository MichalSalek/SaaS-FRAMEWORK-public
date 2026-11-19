// cycles — zero runtime (value) import cycles in main/src and web-1/src.
//
// Successor of tests/audit/circular-imports.sh. A cycle on a VALUE edge can crash a module at
// runtime (TDZ: a symbol is read before the other module finished evaluating).
//
// DECISION: madge through its Node API, not ESLint `import/no-cycle`. web-1 has no
// eslint-plugin-import and no TypeScript import resolver, so its `@app` / `@domain` / `@kernel`
// aliases are unresolvable there. madge resolves aliases through each workspace's own tsconfig
// (`.madgerc` tsConfig); without that an aliased import looks external and the graph shows 0
// cycles where there are some.
//
// Each workspace keeps its own `.madgerc` (skipTypeImports: type-only edges never reach runtime;
// excludeRegExp: the READONLY kernel copy). A missing madge install is an ERROR, not a skipped
// workspace: a gate that cannot measure must not report green.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertPaths,
  newCheck,
  projectRoot,
  report,
  type CheckResult,
  type MutableCheck,
} from './_lib';

/** Workspace → minimum number of modules madge must see (measured 2026-10-23: main 1762, web-1 1140). */
export const WORKSPACES: readonly {
  readonly name: string;
  readonly minModules: number;
}[] = [
  { name: 'main', minModules: 1400 },
  { name: 'web-1', minModules: 900 },
];

interface MadgeResult {
  obj(): Record<string, string[]>;
  circular(): string[][];
  warnings(): { skipped: string[] };
}
type MadgeFn = (
  target: string,
  config: Record<string, unknown>
) => Promise<MadgeResult>;

interface MadgeRc {
  fileExtensions?: string[];
  tsConfig?: string;
  detectiveOptions?: Record<string, unknown>;
  excludeRegExp?: string[];
}

async function loadMadge(wsDir: string): Promise<MadgeFn> {
  const require = createRequire(path.join(wsDir, 'package.json'));
  const mod: unknown = await import(
    pathToFileURL(require.resolve('madge')).href
  );
  const fn = (mod as { default?: unknown }).default ?? mod;
  if (typeof fn !== 'function') {
    throw new Error('madge did not export a function');
  }
  return fn as MadgeFn;
}

export async function checkWorkspace(
  root: string,
  name: string,
  minModules: number,
  loader: (wsDir: string) => Promise<MadgeFn> = loadMadge
): Promise<CheckResult> {
  const check: MutableCheck = newCheck(
    `cycles:${name}`,
    minModules,
    `modules in ${name}/src`
  );
  const wsDir = path.join(root, name);
  assertPaths(check, root, [`${name}/src`, `${name}/.madgerc`]);
  if (check.errors.length > 0) {
    return check;
  }
  const rc = JSON.parse(
    readFileSync(path.join(wsDir, '.madgerc'), 'utf8')
  ) as MadgeRc;
  if (rc.tsConfig !== undefined && !existsSync(path.join(wsDir, rc.tsConfig))) {
    check.errors.push(
      `.madgerc tsConfig does not exist: ${name}/${rc.tsConfig}`
    );
    return check;
  }
  let madge: MadgeFn;
  try {
    madge = await loader(wsDir);
  } catch (error) {
    check.errors.push(
      `madge is not installed in ${name} (devDependency; run npm ci there): ${String(error)}`
    );
    return check;
  }
  const result = await madge(path.join(wsDir, 'src'), {
    ...rc,
    baseDir: wsDir,
    ...(rc.tsConfig !== undefined
      ? { tsConfig: path.join(wsDir, rc.tsConfig) }
      : {}),
  });
  check.sites = Object.keys(result.obj()).length;
  for (const cycle of result.circular()) {
    check.findings.push({
      file: `${name}/${cycle[0] ?? '?'}`,
      line: 1,
      message: `value import cycle: ${cycle.join(' → ')} → ${cycle[0] ?? '?'}. Move the shared symbol out of the cycle, import from the real source instead of a barrel, or make one edge \`import type\`.`,
    });
  }
  return check;
}

export async function run(root: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const ws of WORKSPACES) {
    results.push(await checkWorkspace(root, ws.name, ws.minModules));
  }
  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(report('cycles', await run(projectRoot())));
}
