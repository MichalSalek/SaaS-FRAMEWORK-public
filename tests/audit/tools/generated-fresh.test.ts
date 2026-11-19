// Tests for tools/generated-fresh.ts: temp mini trees with stub generators run through the real
// runner (same Node binary, tsx loader), so the wiring, the no-write modes and the parsing of each
// generator's output are exercised end to end.
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import {
  OPENAPI_COMMITTED,
  PRISMA_DTO_COMMITTED,
  run,
} from './generated-fresh';
import { report, type CheckResult } from './_lib';

const tmpRoots: string[] = [];

after(() => {
  for (const dir of tmpRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const SPEC = (ops: number): string => {
  const paths: Record<string, Record<string, object>> = {};
  for (let i = 0; i < ops; i++) {
    paths[`/api/v1/op-${i}`] = { post: {} };
  }
  return `${JSON.stringify({ openapi: '3.1.0', paths }, null, 2)}\n`;
};

interface Spec {
  testsFail?: boolean;
  registriesStale?: boolean;
  openapiOps?: number;
  committedOps?: number;
  openapiCrash?: boolean;
  llms?: 'fresh' | 'stale' | 'crash';
  mirrors?: number;
  prisma?: 'fresh' | 'stale' | 'crash';
}

function tree(spec: Spec = {}): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nf-genfresh-'));
  tmpRoots.push(root);
  const put = (rel: string, text: string): void => {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  };
  put(
    'scripts/contracts/registry-regions.test.ts',
    `import { it } from 'node:test';
for (let i = 0; i < 5; i++) it('t' + i, () => {});
it('last', () => { if (${String(spec.testsFail ?? false)}) throw new Error('boom'); });
`
  );
  put(
    'scripts/contracts/generate-contract-registries.ts',
    `if (!process.argv.includes('--check')) { console.error('would write'); process.exit(3); }
if (${String(spec.registriesStale ?? false)}) { console.error('✗ stale:\\n  .shared-kernel/x.ts'); process.exit(1); }
console.log('✓ rejestry z kontraktów świeże (kontrakty: 8, pliki: 6)');
`
  );
  put(
    'main/scripts/gen-openapi.ts',
    `import { writeFileSync } from 'node:fs';
const out: string | undefined = process.env.OPENAPI_OUT;
if (out === undefined) { console.error('no OPENAPI_OUT: would write the committed file'); process.exit(3); }
if (${String(spec.openapiCrash ?? false)}) { console.error('✗ gen-openapi: boom'); process.exit(1); }
writeFileSync(out, ${JSON.stringify(SPEC(spec.openapiOps ?? 3))});
`
  );
  put(OPENAPI_COMMITTED, SPEC(spec.committedOps ?? spec.openapiOps ?? 3));
  const llms = spec.llms ?? 'fresh';
  put(
    'main/scripts/generate-llms-md.mjs',
    `if (!process.argv.includes('--check')) { console.error('would write'); process.exit(3); }
const mode = ${JSON.stringify(llms)};
if (mode === 'crash') throw new Error('boom');
if (mode === 'stale') {
  console.error('STALE: main/public/en/about.md');
  console.error('ORPHAN: main/public/blog/old.md (no matching .mdx post)');
  console.error('INDEX: public/llms.txt does not list https://nailfolio.app/blog/x/');
  process.exit(1);
}
console.log('llms-md FRESH (2 plików)');
`
  );
  for (let i = 0; i < (spec.mirrors ?? 2); i++) {
    put(`main/public/${i % 2 === 0 ? '' : 'en/'}page-${i}.md`, '# x\n');
  }
  put('main/public/llms-full.txt', 'x');
  const dto =
    'export type Account = { id: string };\nexport type Visit = { id: string };\n';
  put('scripts/generate-dto/preload.cjs', 'module.exports = {};\n');
  put(
    'scripts/generate-dto/index.ts',
    `import { writeFileSync } from 'node:fs';
const at = process.argv.indexOf('--out');
if (at === -1 || process.argv[at + 1] === undefined) {
  console.error('no --out: would write the committed file');
  process.exit(3);
}
if (${String((spec.prisma ?? 'fresh') === 'crash')}) {
  console.error('prisma boom');
  process.exit(1);
}
writeFileSync(process.argv[at + 1], ${JSON.stringify(
      (spec.prisma ?? 'fresh') === 'stale' ? `${dto}// stale\n` : dto
    )});
`
  );
  put(PRISMA_DTO_COMMITTED, dto);
  return root;
}

const byName = (results: CheckResult[], name: string): CheckResult => {
  const found = results.find(c => c.name === name);
  assert.ok(found, name);
  return found;
};

void describe('generated-fresh', () => {
  void it('passes a fresh tree and counts sites (floors aside)', () => {
    const results = run(tree());
    for (const c of results) {
      assert.deepEqual(c.findings, [], c.name);
      assert.deepEqual(c.errors, [], c.name);
    }
    assert.equal(
      byName(results, 'generated:contracts-generator-tests').sites,
      6
    );
    assert.equal(byName(results, 'generated:contract-registries').sites, 8);
    assert.equal(byName(results, 'generated:openapi').sites, 3);
    assert.equal(byName(results, 'generated:llms-md').sites, 3);
    assert.equal(byName(results, 'generated:prisma-dto').sites, 2);
    assert.equal(
      report('generated-fresh', results),
      1,
      'the real floors break in a mini tree'
    );
  });

  void it('never writes into the tree (generators run in check / temp-output mode)', () => {
    const root = tree();
    const before = readFileSync(path.join(root, OPENAPI_COMMITTED), 'utf8');
    run(root);
    assert.equal(
      readFileSync(path.join(root, OPENAPI_COMMITTED), 'utf8'),
      before
    );
  });

  void it('flags failing generator tests', () => {
    const c = byName(
      run(tree({ testsFail: true })),
      'generated:contracts-generator-tests'
    );
    assert.equal(c.findings.length, 1);
    assert.equal(c.sites, 5);
  });

  void it('flags stale contract registries with the generator output', () => {
    const c = byName(
      run(tree({ registriesStale: true })),
      'generated:contract-registries'
    );
    assert.equal(c.findings.length, 1);
    assert.match(c.findings[0]?.message ?? '', /\.shared-kernel\/x\.ts/);
  });

  void it('flags a stale OpenAPI spec at the first differing line', () => {
    const c = byName(
      run(tree({ openapiOps: 4, committedOps: 3 })),
      'generated:openapi'
    );
    assert.equal(c.findings.length, 1);
    assert.equal(c.findings[0]?.file, OPENAPI_COMMITTED);
    assert.ok((c.findings[0]?.line ?? 0) > 1);
    assert.equal(c.sites, 4);
  });

  void it('flags a generator crash instead of skipping the comparison', () => {
    const c = byName(run(tree({ openapiCrash: true })), 'generated:openapi');
    assert.match(c.findings[0]?.message ?? '', /gen-openapi failed.*boom/);
  });

  void it('lists every stale, orphaned and unindexed llms mirror', () => {
    const c = byName(run(tree({ llms: 'stale' })), 'generated:llms-md');
    assert.deepEqual(
      c.findings.map(f => f.file),
      [
        'main/public/en/about.md',
        'main/public/blog/old.md',
        'main/public/llms.txt',
      ]
    );
  });

  void it('flags a crashing llms generator', () => {
    const c = byName(run(tree({ llms: 'crash' })), 'generated:llms-md');
    assert.match(c.findings[0]?.message ?? '', /generator failed/);
  });

  void it('flags a stale Prisma model DTO', () => {
    const c = byName(run(tree({ prisma: 'stale' })), 'generated:prisma-dto');
    assert.equal(c.findings.length, 1);
    assert.equal(c.findings[0]?.file, PRISMA_DTO_COMMITTED);
    assert.match(c.findings[0]?.message ?? '', /STALE/);
    assert.equal(c.sites, 2);
  });

  void it('flags a Prisma generator crash instead of skipping the diff', () => {
    const c = byName(run(tree({ prisma: 'crash' })), 'generated:prisma-dto');
    assert.match(c.findings[0]?.message ?? '', /generate-dto failed.*prisma boom/);
  });

  void it('does not rewrite the committed Prisma DTO', () => {
    const root = tree();
    const before = readFileSync(path.join(root, PRISMA_DTO_COMMITTED));
    run(root);
    assert.ok(before.equals(readFileSync(path.join(root, PRISMA_DTO_COMMITTED))));
  });

  void it('is an error when a generator or the committed spec is missing', () => {
    const root = tree();
    rmSync(path.join(root, OPENAPI_COMMITTED));
    rmSync(path.join(root, 'main/scripts/generate-llms-md.mjs'));
    rmSync(path.join(root, PRISMA_DTO_COMMITTED));
    const results = run(root);
    assert.match(
      byName(results, 'generated:openapi').errors[0] ?? '',
      /openapi\.generated\.json/
    );
    assert.match(
      byName(results, 'generated:llms-md').errors[0] ?? '',
      /generate-llms-md\.mjs/
    );
    assert.match(
      byName(results, 'generated:prisma-dto').errors[0] ?? '',
      /db_models\.generated\.dto\.ts/
    );
  });
});
