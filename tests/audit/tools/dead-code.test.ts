// Tests for tools/dead-code.ts: temp mini trees under os.tmpdir(); knip, ts-prune and git are
// replaced by recorded outputs (the real tools are exercised by the CLI run on the repository).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import {
  checkKernelExports,
  checkMainExports,
  checkMainFiles,
  checkWeb1Exports,
  filterTsPrune,
  KERNEL,
  KERNEL_GENERATED,
  KNIP_CONFIG,
  MAIN_ALLOWLIST,
  parseKnip,
  realTools,
  tsPruneLines,
  run,
  sweepKernel,
  WEB1_ALLOWLIST,
  WEB1_TSCONFIG,
  type KnipResult,
  type Tools,
} from './dead-code';
import type { CheckResult } from './_lib';

const tmpRoots: string[] = [];
after(() => {
  for (const dir of tmpRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** One dead export per kernel allowlist pattern, so no pattern is a dead anchor. */
const KERNEL_BASE: Record<string, string> = {
  [`${KERNEL}/${KERNEL_GENERATED}`]:
    'export type UnusedModel = { id: string };\n',
  [`${KERNEL}/policies/validation/user.validation.ts`]:
    'export type UserRequestSchemaBindings = { a: 1 };\n',
  [`${KERNEL}/domain/routing/routing.types.ts`]:
    'export type ROUTES_PUBLIC_NAME = string;\n',
  [`${KERNEL}/models/type_narrowing.ts`]:
    'export const isColorNarrower = (v: unknown): boolean => v !== null;\n',
  [`${KERNEL}/domain/session-container/session-container.types.ts`]:
    'export const isDraftSession = (): boolean => true;\n',
  [`${KERNEL}/domain/user-and-account/staff_accounts.config.ts`]:
    'export const hasStaffPermission = (): boolean => true;\nexport const isValidStaffRole = (): boolean => true;\n',
  [`${KERNEL}/domain/platform/platform.config.ts`]:
    "export const PLATFORM_GATE_BYPASS_PARAM = 'x';\nexport const PLATFORM_GATE_BYPASS_STORAGE_KEY = 'y';\n",
  [`${KERNEL}/domain/http/http-methods.config.ts`]:
    'export type ApiHttpMethod = string;\n',
  [`${KERNEL}/domain/user-and-account/role_switch.config.ts`]:
    'export const getOppositeAccountType = (): string => "x";\n',
  [`${KERNEL}/models/user/user.dto.ts`]:
    'export type UserExportNotificationPreferences = { a: 1 };\n',
  [`${KERNEL}/models/user/user.types.ts`]:
    'export type UserWithRelationsExtended = { a: 1 };\n',
};

function base(): Record<string, string> {
  const files: Record<string, string> = {
    ...KERNEL_BASE,
    [KNIP_CONFIG]: '{}\n',
    [WEB1_TSCONFIG]: '{}\n',
    'main/src/index.ts': 'export {};\n',
    'web-1/src/index.ts': 'export {};\n',
    'tests/keep.ts': 'export {};\n',
    'scripts/keep.ts': 'export {};\n',
  };
  for (const entry of Object.keys(WEB1_ALLOWLIST)) {
    files[`web-1/${entry.split(' - ')[0] ?? ''}`] = 'export {};\n';
  }
  for (const entry of Object.keys(MAIN_ALLOWLIST)) {
    files[`main/${entry.split(' - ')[0] ?? ''}`] = 'export {};\n';
  }
  return files;
}

function tree(files: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nf-dead-code-'));
  tmpRoots.push(root);
  for (const [rel, text] of Object.entries({ ...base(), ...files })) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
}

const ALLOWED_TSPRUNE = Object.keys(WEB1_ALLOWLIST)
  .map(entry => entry.replace(' - ', ':1 - '))
  .join('\n');
const CLEAN_KNIP: KnipResult = {
  files: [],
  exports: Object.keys(MAIN_ALLOWLIST),
};

const fake = (over: Partial<Tools> = {}): Tools => ({
  knip: () => CLEAN_KNIP,
  tsPrune: () => ALLOWED_TSPRUNE,
  tracked: (_root, paths) => new Set(paths),
  ...over,
});

const messages = (check: CheckResult): string[] =>
  check.findings.map(f => `${f.file} ${f.message}`);

void describe('dead-code: parsers', () => {
  void it('reads knip JSON (files, exports, types)', () => {
    const parsed = parseKnip(
      JSON.stringify({
        issues: [
          {
            file: 'src/a.ts',
            files: [{ name: 'src/a.ts' }],
            exports: [],
            types: [],
          },
          {
            file: 'src/b.ts',
            files: [],
            exports: [{ name: 'x', line: 1 }],
            types: [{ name: 'T', line: 2 }],
          },
        ],
      })
    );
    assert.deepEqual(
      { files: parsed.files, exports: parsed.exports },
      {
        files: ['src/a.ts'],
        exports: ['src/b.ts - T', 'src/b.ts - x'],
      }
    );
  });

  void it('keeps the line of each finding (knip and ts-prune)', () => {
    const parsed = parseKnip(
      JSON.stringify({
        issues: [
          {
            file: 'src/b.ts',
            files: [],
            exports: [{ name: 'x', line: 7 }],
            types: [],
          },
        ],
      })
    );
    assert.equal(parsed.lines?.get('src/b.ts - x'), 7);
    assert.equal(
      tsPruneLines('src/c.ts:12 - deadThing\n').get('src/c.ts - deadThing'),
      12
    );
  });

  void it('refuses a knip report without an issues array', () => {
    assert.throws(() => parseKnip('{"files":[]}'), /CANNOT MEASURE/);
    assert.throws(() => parseKnip('not json'));
  });

  void it('applies the structural ts-prune filters and drops the volatile line', () => {
    const raw = [
      'src/pages/api/x.ts:3 - handler',
      'src/a.ts:4 - used (used in module)',
      'vitest.config.ts:5 - default',
      'src/types/x.d.ts:4 - User',
      'src/b.ts:26 - satisfies',
      'src/READONLY-shared-kernel/m.ts:9 - Model',
      'src/c.ts:12 - deadThing',
      '',
    ].join('\n');
    assert.deepEqual(filterTsPrune(raw), ['src/c.ts - deadThing']);
  });
});

void describe('dead-code: main-files', () => {
  void it('fails on a tracked unreachable file, ignores an untracked one (another session WIP)', () => {
    const root = tree();
    const knip: KnipResult = {
      files: ['src/dead.ts', 'src/wip.ts'],
      exports: [],
    };
    const c = checkMainFiles(
      root,
      knip,
      fake({ tracked: () => new Set(['src/dead.ts']) })
    );
    assert.deepEqual(
      c.findings.map(f => f.file),
      ['main/src/dead.ts']
    );
  });

  void it('is an error when knip cannot run (the shell guard skipped with exit 0)', () => {
    const c = checkMainFiles(tree(), new Error('knip is missing'), fake());
    assert.deepEqual(c.errors, ['knip is missing']);
  });

  void it('reports a missing knip binary as CANNOT MEASURE', () => {
    assert.throws(() => realTools.knip(tree()), /CANNOT MEASURE/);
    assert.throws(() => realTools.tsPrune(tree()), /CANNOT MEASURE/);
  });

  void it('treats every file as tracked outside a git work tree', () => {
    const root = tree();
    assert.deepEqual([...realTools.tracked(root, ['src/a.ts'])], ['src/a.ts']);
  });
});

void describe('dead-code: web-1 exports', () => {
  void it('accepts allowlisted findings only', () => {
    assert.deepEqual(messages(checkWeb1Exports(tree(), ALLOWED_TSPRUNE)), []);
  });

  void it('rejects a new dead export (the RED-first probe of the shell guard)', () => {
    const c = checkWeb1Exports(
      tree(),
      `${ALLOWED_TSPRUNE}\nsrc/domain/x.ts:3 - __deadExportRatchetProbe`
    );
    assert.deepEqual(
      c.findings.map(f => f.file),
      ['web-1/src/domain/x.ts']
    );
  });

  void it('does not let an allowlisted NAME exempt another file', () => {
    const c = checkWeb1Exports(
      tree(),
      `${ALLOWED_TSPRUNE}\nsrc/other.ts:1 - register`
    );
    assert.deepEqual(
      c.findings.map(f => f.file),
      ['web-1/src/other.ts']
    );
  });

  void it('flags an allowlist entry that exempts nothing today', () => {
    const output = ALLOWED_TSPRUNE.split('\n')
      .filter(l => !l.includes(' - register'))
      .join('\n');
    const c = checkWeb1Exports(tree(), output);
    assert.equal(c.findings.length, 1);
    assert.match(
      c.findings[0]?.message ?? '',
      /dead allowlist anchor "src\/instrumentation\.ts - register"/
    );
  });

  void it('counts export sites (declarations and export lists), pages excluded', () => {
    const c = checkWeb1Exports(
      tree({
        'web-1/src/a.ts':
          'export const a = 1, b = 2;\nexport function f(): void {}\nconst c = 3;\nexport { c };\n',
        'web-1/src/pages/x.ts': 'export const p = 1;\n',
      }),
      ALLOWED_TSPRUNE
    );
    assert.equal(c.sites, 4);
  });
});

void describe('dead-code: kernel exports', () => {
  void it('passes when every exported name is used and every allowlist pattern still matches', () => {
    const root = tree({
      [`${KERNEL}/domain/a.ts`]:
        'export const usedByMain = 1;\nexport type UsedInKernel = string;\nexport const local: UsedInKernel = "x";\n',
      'main/src/use.ts':
        'declare const usedByMain: number;\nexport const y = usedByMain;\nexport const z = 1;\n',
      'tests/use.ts': 'declare const local: string;\nexport const w = local;\n',
    });
    assert.deepEqual(messages(checkKernelExports(root)), []);
  });

  void it('rejects an export used only in comments and strings of consumers (the shell grep counted prose)', () => {
    const root = tree({
      [`${KERNEL}/domain/a.ts`]: 'export const proseOnly = 1;\n',
      'main/src/use.ts':
        "// proseOnly is documented here\nexport const s = 'proseOnly';\nexport const t = `${'x'} proseOnly`;\n",
    });
    const c = checkKernelExports(root);
    assert.deepEqual(
      c.findings.map(f => `${f.file}:${f.line}`),
      [`${KERNEL}/domain/a.ts:1`]
    );
  });

  void it('does not count a use in a READONLY kernel copy', () => {
    const root = tree({
      [`${KERNEL}/domain/a.ts`]: 'export const copied = 1;\n',
      'main/src/READONLY-shared-kernel/domain/a.ts':
        'export const copied = 1;\nexport const again = copied;\n',
    });
    assert.equal(checkKernelExports(root).findings.length, 1);
  });

  void it('sweeps every declarator and skips the generated DTO file', () => {
    const sweep = sweepKernel(
      tree({ [`${KERNEL}/domain/a.ts`]: 'export const one = 1, two = 2;\n' })
    );
    const dead = sweep.dead.map(d => d.entry);
    assert.ok(
      dead.includes('domain/a.ts - one') && dead.includes('domain/a.ts - two')
    );
    assert.ok(!dead.some(d => d.includes('UnusedModel')));
  });

  void it('exempts a generated contract DTO view and still flags a manual one', () => {
    const sweep = sweepKernel(
      tree({
        [`${KERNEL}/models/widget/widget.dto.ts`]: `export type ManualWidget = { a: 1 };
// GENERATED by \`npm run system:contracts\` from domain/widget/widget.contracts.ts.
export type WIDGET_DTO_API_V1 = { WIDGET_CREATE: { REQUEST: X } };
export type NOT_THE_VIEW = { a: 1 };
`,
        [`${KERNEL}/models/hand/hand.dto.ts`]:
          'export type HAND_DTO_API_V1 = { a: 1 };\n',
      })
    );
    const dead = sweep.dead.map(d => d.entry);
    assert.ok(dead.includes('models/widget/widget.dto.ts - ManualWidget'));
    assert.ok(dead.includes('models/widget/widget.dto.ts - NOT_THE_VIEW'));
    assert.ok(dead.includes('models/hand/hand.dto.ts - HAND_DTO_API_V1'));
    assert.ok(!dead.some(d => d.includes('WIDGET_DTO_API_V1')));
    assert.ok(sweep.names > dead.length);
  });

  void it('flags a kernel allowlist pattern that exempts nothing today', () => {
    const root = tree({
      [`${KERNEL}/domain/platform/platform.config.ts`]:
        "export const PLATFORM_GATE_BYPASS_PARAM = 'x';\nexport const PLATFORM_GATE_BYPASS_STORAGE_KEY = 'y';\n",
      'web-1/src/use.ts':
        'declare const PLATFORM_GATE_BYPASS_PARAM: string;\nexport const p = PLATFORM_GATE_BYPASS_PARAM;\n',
    });
    const c = checkKernelExports(root);
    assert.equal(c.findings.length, 1);
    assert.match(c.findings[0]?.message ?? '', /dead allowlist pattern/);
  });

  void it('is an error when an allowlist anchor file is missing', () => {
    const root = tree();
    rmSync(path.join(root, KERNEL, 'models/type_narrowing.ts'));
    assert.match(
      checkKernelExports(root).errors.join(' '),
      /type_narrowing\.ts/
    );
  });
});

void describe('dead-code: main exports', () => {
  void it('accepts allowlisted findings and rejects a new one', () => {
    const root = tree();
    assert.deepEqual(messages(checkMainExports(root, CLEAN_KNIP)), []);
    const c = checkMainExports(root, {
      files: [],
      exports: [...CLEAN_KNIP.exports, 'src/x.ts - dead'],
    });
    assert.deepEqual(
      c.findings.map(f => f.file),
      ['main/src/x.ts']
    );
  });

  void it('flags a dead MAIN_ALLOWLIST anchor', () => {
    const c = checkMainExports(tree(), { files: [], exports: [] });
    assert.equal(c.findings.length, Object.keys(MAIN_ALLOWLIST).length);
  });
});

void describe('dead-code: run', () => {
  void it('returns four checks and turns a tool failure into errors, never a skip', () => {
    const checks = run(
      tree(),
      fake({
        knip: () => {
          throw new Error('knip is missing');
        },
      })
    );
    assert.deepEqual(
      checks.map(c => c.name),
      [
        'dead-code:main-files',
        'dead-exports:web-1',
        'dead-exports:kernel',
        'dead-exports:main',
      ]
    );
    assert.deepEqual(checks[0]?.errors, ['knip is missing']);
    assert.deepEqual(checks[3]?.errors, ['knip is missing']);
  });
});

void describe('real tool output transport', () => {
  void it('reads all stdout from a tool that exits immediately after a large write', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'nf-prune-pipe-'));
    tmpRoots.push(root);
    const dir = path.join(root, 'web-1/node_modules/.bin');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'ts-prune'),
      `#!${process.execPath}\nprocess.stdout.write('x'.repeat(4 * 1024 * 1024)); process.exit(0);\n`,
      { mode: 0o755 }
    );
    assert.equal(realTools.tsPrune(root).length, 4 * 1024 * 1024);
  });
  void it('does not treat a partial report followed by a tool failure as a valid measurement', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'nf-prune-failed-'));
    tmpRoots.push(root);
    const dir = path.join(root, 'web-1/node_modules/.bin');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'ts-prune'),
      `#!${process.execPath}\nprocess.stdout.write('partial report'); process.exit(2);\n`,
      { mode: 0o755 }
    );
    assert.throws(() => realTools.tsPrune(root));
  });
});
