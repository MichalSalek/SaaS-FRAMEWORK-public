// Tests for tools/better-auth-contract.ts: temp mini trees under os.tmpdir(). The first block
// replays every sample of the retired fixture set
// tests/audit/_fixtures/better-auth-dispatch-contract (inlined, so the proof survives the fixture
// directory's retirement).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import {
  ACCESSOR,
  checkAccessorOnly,
  checkRuntime,
  run,
} from './better-auth-contract';
import type { CheckResult } from './_lib';

const tmpRoots: string[] = [];
after(() => {
  for (const dir of tmpRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const DISPATCH = 'web-1/node_modules/better-auth/dist/api/dispatch.mjs';
const PKG = 'web-1/node_modules/better-auth/package.json';
const INTACT = `async function runAfterHooks(context, hooks, endpoint, operationId) {
	if (result.response !== void 0) context.context.returned = result.response;
	return { response: context.context.returned, headers: context.context.responseHeaders };
}
async function dispatchAuthEndpoint(internalContext) {
	internalContext.context.returned = result.response;
	internalContext.context.responseHeaders = result.headers ?? void 0;
}
`;
const ACCESSOR_STUB = `type FixtureCtx = { readonly context?: { readonly [k: string]: unknown } };
type DispatchRuntimeFields = { readonly returned?: unknown; readonly responseHeaders?: Headers | undefined };
const readDispatchFields = (ctx: FixtureCtx): DispatchRuntimeFields => (ctx.context ?? {}) as DispatchRuntimeFields;
export const getDispatchReturned = (ctx: FixtureCtx): unknown => readDispatchFields(ctx).returned;
export const getDispatchResponseHeaders = (ctx: FixtureCtx): Headers | undefined =>
  readDispatchFields(ctx).responseHeaders;
// A direct read inside the accessor itself is the one allowed place.
export const raw = (ctx: { context: { returned?: unknown } }): unknown => ctx.context.returned;
`;
const CONSUMERS = 'web-1/src/application/auth/better-auth/consumers.ts';
const CONSUMERS_TEXT = `type FixtureCtx = { readonly context?: { readonly [k: string]: unknown } };
declare const getDispatchReturned: (ctx: FixtureCtx) => unknown;
declare const getDispatchResponseHeaders: (ctx: FixtureCtx) => Headers | undefined;
export const trackFailure = (ctx: FixtureCtx): unknown => getDispatchReturned(ctx);
export const bridge = (ctx: FixtureCtx): string | null => getDispatchResponseHeaders(ctx)?.get('location') ?? null;
`;

function tree(files: Record<string, string | null>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nf-ba-contract-'));
  tmpRoots.push(root);
  const base: Record<string, string | null> = {
    [DISPATCH]: INTACT,
    [PKG]: '{ "name": "better-auth", "version": "9.9.9-fixture" }\n',
    [ACCESSOR]: ACCESSOR_STUB,
    [CONSUMERS]: CONSUMERS_TEXT,
    'main/src/keep.ts': 'export {};\n',
    '.shared-kernel/keep.ts': 'export {};\n',
  };
  for (const [rel, text] of Object.entries({ ...base, ...files })) {
    if (text === null) {
      continue;
    }
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
}

const bad = (checks: readonly CheckResult[]): string[] =>
  checks
    .filter(
      c => c.findings.length > 0 || c.errors.length > 0 || c.sites < c.minSites
    )
    .map(c => c.name);

void describe('better-auth-contract: retired fixture samples', () => {
  void it('must-pass/contract-intact', () => {
    assert.deepEqual(bad(run(tree({}))), []);
  });

  void it('must-pass/decision-comment-only', () => {
    const root = tree({
      'web-1/src/application/auth/better-auth/prose.ts': `/**
 * DECISION: Hook-runner pisze ctx.context.returned oraz ctx.context.responseHeaders tuż przed hooks.after.
 */
// Kiedyś stało tu ctx.context?.returned — dziś idzie to przez getDispatchReturned.
export const nothingToSeeHere = (): null => null;
`,
    });
    assert.deepEqual(bad(run(root)), []);
  });

  void it('must-pass/string-mention-only (a test NAME quoting the field, S121)', () => {
    const root = tree({
      'web-1/src/application/auth/better-auth/spec.ts': `declare const describe: (name: string, fn: () => void) => void;
export const spec = (): void => {
  describe('handleAuthFailure — kontrakt ctx.context.returned', () => {
    const label: string = 'czyta ctx.context.responseHeaders przez akcesor';
    const tpl = \`also \${label} ctx.context.returned\`;
    void tpl;
  });
};
`,
    });
    assert.deepEqual(bad(run(root)), []);
  });

  void it('must-fail/direct-read-bypassing-accessor', () => {
    const root = tree({
      [CONSUMERS]: `${CONSUMERS_TEXT}export const sneaky = (ctx: FixtureCtx): unknown => ctx.context?.returned;\n`,
    });
    const c = checkAccessorOnly(root);
    assert.deepEqual(
      c.findings.map(f => `${f.file}:${f.line}`),
      [`${CONSUMERS}:6`]
    );
  });

  void it('must-fail/runtime-returned-gone', () => {
    const root = tree({
      [DISPATCH]: `async function dispatchAuthEndpoint(internalContext) {
	internalContext.context.responseHeaders = result.headers ?? void 0;
	if (internalContext.context.returned === undefined) return null;
}
`,
    });
    const checks = checkRuntime(root);
    assert.deepEqual(bad(checks), ['better-auth:runtime-returned']);
    assert.match(checks[0]?.findings[0]?.message ?? '', /CANNOT_LOGIN/);
    assert.match(checks[0]?.findings[0]?.message ?? '', /9\.9\.9-fixture/);
  });

  void it('must-fail/runtime-response-headers-gone', () => {
    const root = tree({
      [DISPATCH]:
        'async function dispatchAuthEndpoint(internalContext) {\n\tinternalContext.context.returned = result.response;\n}\n',
    });
    const checks = checkRuntime(root);
    assert.deepEqual(bad(checks), ['better-auth:runtime-response-headers']);
    assert.match(checks[1]?.findings[0]?.message ?? '', /token bridge/);
  });

  void it('must-fail/library-not-measurable', () => {
    const root = tree({ [DISPATCH]: null, [PKG]: null });
    const checks = checkRuntime(root);
    assert.deepEqual(bad(checks), [
      'better-auth:runtime-returned',
      'better-auth:runtime-response-headers',
    ]);
    assert.match(checks[0]?.errors[0] ?? '', /CANNOT MEASURE/);
  });
});

void describe('better-auth-contract: runtime half reads code, not text', () => {
  void it('rejects an assignment that survives only in a comment of the bundle', () => {
    const root = tree({
      [DISPATCH]:
        '// internalContext.context.returned = result.response;\ninternalContext.context.responseHeaders = h;\n',
    });
    assert.deepEqual(bad(checkRuntime(root)), ['better-auth:runtime-returned']);
  });

  void it('does not take a bare `context.responseHeaders =` (another object) for the contract', () => {
    // dispatch.mjs line 33 shape: the shell grep counted it, so the real assignment could vanish unseen.
    const root = tree({
      [DISPATCH]:
        'if (!context.responseHeaders) context.responseHeaders = new Headers();\ninternalContext.context.returned = r;\n',
    });
    assert.deepEqual(bad(checkRuntime(root)), [
      'better-auth:runtime-response-headers',
    ]);
  });

  void it('rejects a comparison posing as an assignment', () => {
    const root = tree({
      [DISPATCH]:
        'if (a.context.returned === b) {}\na.context.responseHeaders = h;\n',
    });
    assert.deepEqual(bad(checkRuntime(root)), ['better-auth:runtime-returned']);
  });

  void it('is an error when dispatch.mjs is empty', () => {
    const root = tree({ [DISPATCH]: '\n' });
    assert.match(checkRuntime(root)[0]?.errors[0] ?? '', /EMPTY/);
  });

  void it('finds the package hoisted to the repository root', () => {
    const root = tree({
      [DISPATCH]: null,
      [PKG]: null,
      'node_modules/better-auth/dist/api/dispatch.mjs': INTACT,
    });
    assert.deepEqual(bad(checkRuntime(root)), []);
  });
});

void describe('better-auth-contract: accessor-only', () => {
  const read = (body: string): CheckResult =>
    checkAccessorOnly(
      tree({
        'main/src/reader.tsx': `declare const ctx: { context: Record<string, unknown> };\n${body}\n`,
      })
    );

  void it('rejects an element access (bypass the shell regex missed)', () => {
    assert.equal(
      read("export const x = ctx.context['responseHeaders'];").findings.length,
      1
    );
  });

  void it('rejects a destructuring read', () => {
    assert.equal(
      read('export const { returned: r } = ctx.context;').findings.length,
      1
    );
  });

  void it('accepts unrelated `returned` names', () => {
    assert.equal(
      read('export const returned = 1;\nexport const y = { returned };')
        .findings.length,
      0
    );
  });

  void it('counts an aliased accessor call as a site', () => {
    const root = tree({
      [CONSUMERS]: `import { getDispatchReturned as ret } from './better-auth-dispatch-context';
export const a = (c: { context?: Record<string, unknown> }): unknown => ret(c);
`,
    });
    assert.equal(checkAccessorOnly(root).sites, 1);
  });

  void it('breaks the floor when the accessor is no longer called', () => {
    const c = checkAccessorOnly(tree({ [CONSUMERS]: 'export {};\n' }));
    assert.ok(c.sites < c.minSites);
  });

  void it('skips READONLY kernel copies', () => {
    const c = checkAccessorOnly(
      tree({
        'web-1/src/READONLY-shared-kernel/x.ts':
          'declare const c: { context: { returned: 1 } };\nexport const y = c.context.returned;\n',
      })
    );
    assert.equal(c.findings.length, 0);
  });

  void it('is an error when the accessor file is missing', () => {
    const c = checkAccessorOnly(tree({ [ACCESSOR]: null }));
    assert.match(c.errors.join(' '), /better-auth-dispatch-context\.ts/);
  });
});
