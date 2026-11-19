// Tests for tools/cycles.ts: temp mini workspaces, madge loaded from the real main workspace.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { checkWorkspace } from './cycles';
import { projectRoot } from './_lib';

const REAL_MAIN = path.join(projectRoot(), 'main');
const tmpRoots: string[] = [];

after(() => {
  for (const dir of tmpRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const MADGERC = {
  fileExtensions: ['ts', 'tsx'],
  tsConfig: 'tsconfig.json',
  detectiveOptions: {
    ts: { skipTypeImports: true },
    tsx: { skipTypeImports: true },
  },
  excludeRegExp: ['READONLY-shared-kernel'],
};

const TSCONFIG = {
  compilerOptions: { baseUrl: '.', paths: { '@app/*': ['./src/app/*'] } },
  include: ['src/**/*.ts'],
};

/** Builds `<tmp>/ws` with the given src files; returns the tmp root. */
function miniTree(files: Record<string, string>, withRc = true): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nf-cycles-'));
  tmpRoots.push(root);
  const ws = path.join(root, 'ws');
  mkdirSync(path.join(ws, 'src'), { recursive: true });
  writeFileSync(path.join(ws, 'package.json'), '{"name":"ws"}');
  writeFileSync(path.join(ws, 'tsconfig.json'), JSON.stringify(TSCONFIG));
  if (withRc) {
    writeFileSync(path.join(ws, '.madgerc'), JSON.stringify(MADGERC));
  }
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(ws, 'src', rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  return root;
}

async function realMadge(): Promise<never> {
  const require = createRequire(path.join(REAL_MAIN, 'package.json'));
  const mod: unknown = await import(
    pathToFileURL(require.resolve('madge')).href
  );
  return ((mod as { default?: unknown }).default ?? mod) as never;
}

const check = (root: string, min = 1) =>
  checkWorkspace(root, 'ws', min, realMadge);

void describe('cycles', () => {
  void it('reports a value cycle between two modules', async () => {
    const root = miniTree({
      'a.ts': "import { b } from './b';\nexport const a = () => b;\n",
      'b.ts': "import { a } from './a';\nexport const b = () => a;\n",
    });
    const result = await check(root);
    assert.equal(result.findings.length, 1);
    assert.match(result.findings[0]?.message ?? '', /value import cycle/);
  });

  void it('reports a cycle that closes through a tsconfig alias (the 27-cycle barrel class)', async () => {
    const root = miniTree({
      'app/barrel.ts': "export { user } from '../domain/user';\n",
      'domain/user.ts':
        "import { log } from '../log';\nexport const user = () => log;\n",
      'log.ts':
        "import { user } from '@app/barrel';\nexport const log = () => user;\n",
    });
    const result = await check(root);
    assert.equal(result.findings.length, 1);
  });

  void it('reports a three-module cycle', async () => {
    const root = miniTree({
      'a.ts': "import { b } from './b';\nexport const a = () => b;\n",
      'b.ts': "import { c } from './c';\nexport const b = () => c;\n",
      'c.ts': "import { a } from './a';\nexport const c = () => a;\n",
    });
    assert.equal((await check(root)).findings.length, 1);
  });

  void it('ignores a cycle whose one edge is type-only', async () => {
    const root = miniTree({
      'a.ts':
        "import type { B } from './b';\nexport type A = { b?: B };\nexport const a = 1;\n",
      'b.ts':
        "import { a } from './a';\nexport type B = number;\nexport const b = a;\n",
    });
    const result = await check(root);
    assert.equal(result.findings.length, 0);
    assert.equal(result.sites, 2);
  });

  void it('ignores an acyclic graph and cycles inside the READONLY kernel copy', async () => {
    const root = miniTree({
      'a.ts': "import { b } from './b';\nexport const a = b;\n",
      'b.ts': 'export const b = 1;\n',
      'READONLY-shared-kernel/x.ts':
        "import { y } from './y';\nexport const x = () => y;\n",
      'READONLY-shared-kernel/y.ts':
        "import { x } from './x';\nexport const y = () => x;\n",
    });
    const result = await check(root);
    assert.equal(result.findings.length, 0);
  });

  void it('a prose mention of an import is not an edge', async () => {
    const root = miniTree({
      'a.ts':
        "// import { b } from './b';\nexport const a = 'import { b } from \"./b\"';\n",
      'b.ts': "import { a } from './a';\nexport const b = a;\n",
    });
    assert.equal((await check(root)).findings.length, 0);
  });

  void it('fails without .madgerc, without madge and below the floor', async () => {
    const noRc = miniTree({ 'a.ts': 'export const a = 1;\n' }, false);
    assert.ok((await check(noRc)).errors.some(e => e.includes('.madgerc')));

    const root = miniTree({ 'a.ts': 'export const a = 1;\n' });
    const missing = await checkWorkspace(root, 'ws', 1, () =>
      Promise.reject(new Error('nope'))
    );
    assert.ok(missing.errors.some(e => e.includes('madge is not installed')));

    const floor = await check(root, 5);
    assert.equal(floor.sites, 1);
    assert.ok(floor.sites < floor.minSites);
  });
});
