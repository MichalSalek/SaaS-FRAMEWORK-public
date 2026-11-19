// Tests for tools/strictness.ts: temp mini trees with a minimal flat config per workspace.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { coverageGap, run, type Scope } from './strictness';
import { projectRoot } from './_lib';
import { TYPESCRIPT_STRICTNESS_SAMPLES } from './_retired-fixtures';

const REPO = projectRoot();
const TS_ESLINT_URL = pathToFileURL(
  createRequire(path.join(REPO, 'package.json')).resolve('typescript-eslint')
).href;
const tmpRoots: string[] = [];

after(() => {
  for (const dir of tmpRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const BAN = `['error', { 'ts-expect-error': true, 'ts-ignore': true, 'ts-nocheck': true }]`;

/** A flat config that enforces the three rules, plus optional extra blocks (as source text). */
function config(extraBlocks = ''): string {
  return `import tseslint from '${TS_ESLINT_URL}';
export default [
  { files: ['**/*.ts', '**/*.tsx'], plugins: { '@typescript-eslint': tseslint.plugin },
    rules: { '@typescript-eslint/no-explicit-any': 'error', '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': ${BAN} } },
  ${extraBlocks}
];
`;
}

const SCOPE: Scope = {
  workspace: 'ws',
  root: 'ws/src',
  minFiles: 1,
  measuredOnly: [],
  exclude: [],
};

function miniTree(files: Record<string, string>, cfg = config()): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nf-strictness-'));
  tmpRoots.push(root);
  mkdirSync(path.join(root, 'ws/src'), { recursive: true });
  writeFileSync(path.join(root, 'ws/eslint.config.mjs'), cfg);
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, 'ws/src', rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  return root;
}

async function findings(
  files: Record<string, string>,
  cfg?: string,
  scope = SCOPE
): Promise<string[]> {
  const [check] = await run(miniTree(files, cfg), [scope]);
  assert.ok(check);
  assert.deepEqual(check.errors, []);
  return check.findings.map(f => `${f.file}:${f.line} ${f.message}`);
}

function samples(kind: 'must-fail' | 'must-pass'): [string, string][] {
  return Object.entries(TYPESCRIPT_STRICTNESS_SAMPLES[kind]);
}

void describe('strictness: fixtures of typescript-strictness.sh', () => {
  for (const [name, text] of samples('must-fail')) {
    void it(`must-fail/${name} is reported`, async () => {
      assert.ok(
        (await findings({ [name]: text })).some(f =>
          f.includes('@typescript-eslint/')
        )
      );
    });
  }
  for (const [name, text] of samples('must-pass')) {
    void it(`must-pass/${name} passes`, async () => {
      assert.deepEqual(await findings({ [name]: text }), []);
    });
  }
});

void describe('strictness: rules', () => {
  const rejected: Record<string, string> = {
    'AU-3 trailing non-null':
      'declare const currentUser: { id?: string };\nexport const id = currentUser.id!;\n',
    'non-null before member':
      'declare const currentUser: { id: string } | null;\nexport const id = currentUser!.id;\n',
    'non-null as argument':
      'declare const x: string | null;\ndeclare function f(s: string): void;\nf(x!);\n',
    'as any': 'export const m = (globalThis as any).x;\n',
    'any in generic': 'export const xs: Array<any> = [];\n',
    'ts-expect-error':
      '// @ts-expect-error legacy\nexport const a: number = "x";\n',
    'ts-nocheck': '// @ts-nocheck\nexport const a = 1;\n',
    'block ts-ignore': '/* @ts-ignore */\nexport const a: number = "x";\n',
    'disable comment does not help':
      '// eslint-disable-next-line @typescript-eslint/no-explicit-any\nexport const a: any = 1;\n',
  };
  for (const [label, code] of Object.entries(rejected)) {
    void it(`rejects: ${label}`, async () => {
      assert.ok(
        (await findings({ 'x.ts': code })).some(f =>
          f.includes('@typescript-eslint/')
        ),
        label
      );
    });
  }

  void it('rejects @ts-ignore inside a JSX comment', async () => {
    const code =
      'export const C = () => (\n  <div>\n    {/* @ts-ignore */}\n    <span />\n  </div>\n);\n';
    assert.ok(
      (await findings({ 'x.tsx': code })).some(f =>
        f.includes('ban-ts-comment')
      )
    );
  });

  const accepted: Record<string, string> = {
    'optional chaining':
      'declare const u: { id?: string } | null;\nexport const id = u?.id ?? "";\n',
    'unknown and narrowing':
      'export const f = (x: unknown): string => (typeof x === "string" ? x : "");\n',
    'prose in comments and strings':
      '// value!.prop and : any and @ts-ignore\n/* x as any */\nexport const s = "a!.b : any";\nexport const t = `x!.y ${"as any"}`;\n',
    'logical not and !=':
      'declare const a: number;\nexport const b = !a || a != 2 || !!a;\n',
  };
  for (const [label, code] of Object.entries(accepted)) {
    void it(`accepts: ${label}`, async () => {
      assert.deepEqual(await findings({ 'x.ts': code }), []);
    });
  }
});

void describe('strictness: coverage of the real config', () => {
  void it('reports a file whose config switches a rule off', async () => {
    const cfg = config(
      `{ files: ['src/off.ts'], rules: { '@typescript-eslint/no-non-null-assertion': 'off' } },`
    );
    const out = await findings(
      { 'off.ts': 'export const a = 1;\n', 'on.ts': 'export const b = 1;\n' },
      cfg
    );
    assert.equal(out.length, 1);
    assert.match(out[0] ?? '', /off\.ts.*no-non-null-assertion is not 'error'/);
  });

  void it('reports a file the config ignores', async () => {
    const cfg = config(`{ ignores: ['src/legacy/**'] },`);
    const out = await findings({ 'legacy/a.ts': 'export const a = 1;\n' }, cfg);
    assert.ok(out.some(line => line.includes('ignored by')));
  });

  void it('reports ban-ts-comment that only demands a description', async () => {
    const cfg = config(
      `{ files: ['**/*.ts'], rules: { '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': 'allow-with-description' }] } },`
    );
    const out = await findings({ 'a.ts': 'export const a = 1;\n' }, cfg);
    assert.ok(out.some(line => line.includes('@ts-expect-error outright')));
  });

  void it('measures but does not coverage-check a measuredOnly prefix', async () => {
    const cfg = config(`{ ignores: ['src/copy/**'] },`);
    const scope: Scope = {
      ...SCOPE,
      measuredOnly: [{ prefix: 'ws/src/copy/', reason: 'test' }],
    };
    assert.deepEqual(
      await findings({ 'copy/a.ts': 'export const a = 1;\n' }, cfg, scope),
      []
    );
    const bad = await findings(
      { 'copy/a.ts': 'export const a: any = 1;\n' },
      cfg,
      scope
    );
    assert.equal(bad.length, 1);
  });

  void it('coverageGap accepts the real option shape', () => {
    assert.equal(
      coverageGap({
        '@typescript-eslint/no-explicit-any': [2],
        '@typescript-eslint/no-non-null-assertion': [2],
        '@typescript-eslint/ban-ts-comment': [
          2,
          {
            'ts-expect-error': true,
            'ts-ignore': true,
            'ts-nocheck': true,
            'ts-check': false,
          },
        ],
      }),
      null
    );
  });

  void it('fails on a missing root, a dead measuredOnly path and below the floor', async () => {
    const root = miniTree({ 'a.ts': 'export const a = 1;\n' });
    const [missing] = await run(root, [{ ...SCOPE, root: 'ws/nope' }]);
    assert.ok(missing?.errors.some(e => e.includes('ws/nope')));
    const [dead] = await run(root, [
      { ...SCOPE, measuredOnly: [{ prefix: 'ws/src/gone/', reason: 'x' }] },
    ]);
    assert.ok(dead?.errors.some(e => e.includes('ws/src/gone/')));
    const [floor] = await run(root, [{ ...SCOPE, minFiles: 3 }]);
    assert.equal(floor?.sites, 1);
  });
});
