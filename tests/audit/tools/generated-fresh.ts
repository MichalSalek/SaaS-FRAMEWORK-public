// generated-fresh — committed generated artefacts equal a fresh run of their generators.
// Successor of openapi-fresh.sh, llms-md-fresh.sh and the Prisma half of dto-completeness.sh.
// Five checks, each running a generator without writing into the repository:
//  1. contracts-generator-tests: scripts/contracts/registry-regions.test.ts passes.
//  2. contract-registries: generate-contract-registries.ts --check (compares in memory).
//  3. openapi: main/scripts/gen-openapi.ts (OPENAPI_OUT) equals
//     main/src/application/api-docs/openapi.generated.json byte for byte.
//  4. llms-md: generate-llms-md.mjs --check mirrors public pages and the live posts.
//  5. prisma-dto: scripts/generate-dto/index.ts --out <temp> equals
//     .shared-kernel/models/db_models.generated.dto.ts. Operation DTO blocks are d1:dto-ops.
// DECISION: generators run as child processes of this tool's Node and tsx, never through
// npx or a shell. A crash is a finding with its output, not a skip.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  assertPaths,
  newCheck,
  projectRoot,
  report,
  walk,
  type CheckResult,
  type MutableCheck,
} from './_lib';

export const REGISTRY_TESTS = 'scripts/contracts/registry-regions.test.ts';
export const REGISTRY_GENERATOR =
  'scripts/contracts/generate-contract-registries.ts';
export const OPENAPI_GENERATOR = 'main/scripts/gen-openapi.ts';
export const OPENAPI_COMMITTED =
  'main/src/application/api-docs/openapi.generated.json';
export const LLMS_GENERATOR = 'main/scripts/generate-llms-md.mjs';
export const LLMS_PUBLIC = 'main/public';
export const PRISMA_DTO_GENERATOR = 'scripts/generate-dto/index.ts';
export const PRISMA_DTO_PRELOAD = 'scripts/generate-dto/preload.cjs';
export const PRISMA_DTO_COMMITTED =
  '.shared-kernel/models/db_models.generated.dto.ts';

/**
 * Presence floors (measured 2026-10-23 → floor): registry generator tests 5 → 4; API contracts
 * 8 → 5; OpenAPI operations 212 → 170; llms mirrors 54 → 40; Prisma model DTO exports 95 → 70.
 */
export const FLOORS = {
  registryTests: 4,
  contracts: 5,
  openapiOperations: 170,
  llmsMirrors: 40,
  prismaModels: 70,
} as const;

export interface RunResult {
  readonly status: number | null;
  readonly output: string;
}

/** Runs a script with the current Node binary; `tsx` adds the TypeScript loader. */
export type Runner = (
  cwd: string,
  args: readonly string[],
  env?: Record<string, string>
) => RunResult;

const TSX_ESM = import.meta.resolve('tsx/esm');

export const nodeRunner: Runner = (cwd, args, env = {}) => {
  // DECISION: NODE_TEST_CONTEXT is dropped. Inherited from a node:test parent (this tool's own
  // tests, or any harness that runs it), it turns a child `node --test` into a subtest reporter
  // that prints no TAP summary and exits 0 on a failing test: a false green.
  const { NODE_TEST_CONTEXT: _inherited, ...parentEnv } = process.env;
  void _inherited;
  const result = spawnSync(process.execPath, [...args], {
    cwd,
    encoding: 'utf8',
    env: { ...parentEnv, ...env },
    maxBuffer: 64 * 1024 * 1024,
  });
  const error = result.error === undefined ? '' : `\n${String(result.error)}`;
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}${error}`,
  };
};

const tsxArgs = (...rest: string[]): string[] => ['--import', TSX_ESM, ...rest];

/** Last lines of a tool's output, for a finding message. */
function tail(output: string, lines = 15): string {
  const all = output.trim().split('\n');
  return all.slice(-lines).join(' | ');
}

function checkRegistryTests(root: string, runner: Runner): CheckResult {
  const check: MutableCheck = newCheck(
    'generated:contracts-generator-tests',
    FLOORS.registryTests,
    'generator tests passed'
  );
  assertPaths(check, root, [REGISTRY_TESTS]);
  if (check.errors.length > 0) {
    return check;
  }
  const result = runner(
    root,
    tsxArgs('--test', '--test-reporter=tap', REGISTRY_TESTS)
  );
  check.sites = Number(/^# pass (\d+)$/m.exec(result.output)?.[1] ?? '0');
  if (result.status !== 0) {
    check.findings.push({
      file: REGISTRY_TESTS,
      line: 1,
      message: `the contract-registry generator tests fail (details: npm run test:contracts-generator): ${tail(result.output)}`,
    });
  }
  return check;
}

function checkRegistries(root: string, runner: Runner): CheckResult {
  const check: MutableCheck = newCheck(
    'generated:contract-registries',
    FLOORS.contracts,
    'API contracts'
  );
  assertPaths(check, root, [REGISTRY_GENERATOR]);
  if (check.errors.length > 0) {
    return check;
  }
  const result = runner(root, tsxArgs(REGISTRY_GENERATOR, '--check'));
  check.sites = Number(/kontrakty: (\d+)/.exec(result.output)?.[1] ?? '0');
  if (result.status !== 0) {
    check.findings.push({
      file: REGISTRY_GENERATOR,
      line: 1,
      message: `registries generated from the API contracts are stale or a region is missing. Fix: npm run system:contracts && npm run system:kernel. Output: ${tail(result.output)}`,
    });
  }
  return check;
}

/** Number of operations (path × HTTP method) in an OpenAPI document. */
function countOperations(text: string): number {
  const doc = JSON.parse(text) as {
    paths?: Record<string, Record<string, unknown>>;
  };
  const methods = new Set([
    'get',
    'put',
    'post',
    'delete',
    'options',
    'head',
    'patch',
    'trace',
  ]);
  return Object.values(doc.paths ?? {}).reduce(
    (sum, item) =>
      sum + Object.keys(item).filter(key => methods.has(key)).length,
    0
  );
}

function checkOpenapi(root: string, runner: Runner): CheckResult {
  const check: MutableCheck = newCheck(
    'generated:openapi',
    FLOORS.openapiOperations,
    'OpenAPI operations'
  );
  assertPaths(check, root, [OPENAPI_GENERATOR, OPENAPI_COMMITTED]);
  if (check.errors.length > 0) {
    return check;
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nf-openapi-'));
  try {
    const out = path.join(dir, 'openapi.json');
    const result = runner(
      path.join(root, 'main'),
      tsxArgs('scripts/gen-openapi.ts'),
      { OPENAPI_OUT: out }
    );
    if (result.status !== 0 || !existsSync(out)) {
      check.findings.push({
        file: OPENAPI_GENERATOR,
        line: 1,
        message: `gen-openapi failed, so the map cannot be compared: ${tail(result.output)}`,
      });
      return check;
    }
    const fresh = readFileSync(out);
    const committed = readFileSync(path.join(root, OPENAPI_COMMITTED));
    try {
      check.sites = countOperations(fresh.toString('utf8'));
    } catch (error) {
      check.errors.push(
        `gen-openapi wrote a document that is not JSON: ${String(error)}`
      );
    }
    if (!fresh.equals(committed)) {
      const a = committed.toString('utf8').split('\n');
      const b = fresh.toString('utf8').split('\n');
      let line = 0;
      while (line < a.length && line < b.length && a[line] === b[line]) {
        line++;
      }
      check.findings.push({
        file: OPENAPI_COMMITTED,
        line: line + 1,
        message:
          'OpenAPI spec is STALE: DTO, routing or methods changed without a regen. Fix: cd main && npm run dev:gen-openapi (and commit openapi.generated.json).',
      });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return check;
}

function checkLlmsMd(root: string, runner: Runner): CheckResult {
  const check: MutableCheck = newCheck(
    'generated:llms-md',
    FLOORS.llmsMirrors,
    `mirrors in ${LLMS_PUBLIC}`
  );
  assertPaths(check, root, [LLMS_GENERATOR, LLMS_PUBLIC]);
  if (check.errors.length > 0) {
    return check;
  }
  // Sites = the mirrors on disk (every *.md under public/ plus llms-full.txt), counted here and
  // not taken from the generator, so a generator that silently emits nothing cannot pass.
  check.sites =
    walk(root, LLMS_PUBLIC, rel => rel.endsWith('.md')).length +
    (existsSync(path.join(root, LLMS_PUBLIC, 'llms-full.txt')) ? 1 : 0);
  const result = runner(path.join(root, 'main'), [
    path.join('scripts', 'generate-llms-md.mjs'),
    '--check',
  ]);
  if (result.status !== 0) {
    const lines = result.output
      .split('\n')
      .filter(l => /^(STALE|ORPHAN|INDEX): /.test(l));
    for (const line of lines) {
      const file = /(?:main\/)?public\/\S+/.exec(line)?.[0] ?? LLMS_GENERATOR;
      check.findings.push({
        file: file.startsWith('main/') ? file : `main/${file}`,
        line: 1,
        message: `${line}. Fix: cd main && npm run generate:llms-md (commit the result); llms*.txt indexes are fixed by hand.`,
      });
    }
    if (lines.length === 0) {
      check.findings.push({
        file: LLMS_GENERATOR,
        line: 1,
        message: `generator failed: ${tail(result.output)}`,
      });
    }
  }
  return check;
}

function checkPrismaDto(root: string, runner: Runner): CheckResult {
  const check: MutableCheck = newCheck(
    'generated:prisma-dto',
    FLOORS.prismaModels,
    'Prisma model DTO exports'
  );
  assertPaths(check, root, [
    PRISMA_DTO_GENERATOR,
    PRISMA_DTO_PRELOAD,
    PRISMA_DTO_COMMITTED,
  ]);
  if (check.errors.length > 0) {
    return check;
  }
  const committedPath = path.join(root, PRISMA_DTO_COMMITTED);
  const committed = readFileSync(committedPath);
  check.sites = (
    committed.toString('utf8').match(/^export (?:type|interface|enum|const) /gm) ??
    []
  ).length;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nf-prisma-dto-'));
  try {
    const out = path.join(dir, 'db_models.generated.dto.ts');
    const result = runner(root, [
      '--require',
      `./${PRISMA_DTO_PRELOAD}`,
      '--import',
      TSX_ESM,
      PRISMA_DTO_GENERATOR,
      '--out',
      out,
    ]);
    if (result.status !== 0 || !existsSync(out)) {
      check.findings.push({
        file: PRISMA_DTO_GENERATOR,
        line: 1,
        message: `system:generate-dto failed, so the Prisma DTO cannot be compared: ${tail(result.output)}`,
      });
      return check;
    }
    const fresh = readFileSync(out);
    if (!fresh.equals(committed)) {
      check.findings.push({
        file: PRISMA_DTO_COMMITTED,
        line: 1,
        message:
          'Prisma model DTO is STALE. Fix: npm run system:generate-dto (commit db_models.generated.dto.ts).',
      });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return check;
}

export function run(root: string, runner: Runner = nodeRunner): CheckResult[] {
  return [
    checkRegistryTests(root, runner),
    checkRegistries(root, runner),
    checkOpenapi(root, runner),
    checkLlmsMd(root, runner),
    checkPrismaDto(root, runner),
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(report('generated-fresh', run(projectRoot())));
}
