// Tests for tools/stripe.ts: temp mini trees under os.tmpdir().
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import {
  checkClaimFirst,
  checkNoApiInTx,
  checkScope,
  checkUiMode,
  HANDLERS,
  ROUTER,
} from './stripe';
import type { CheckResult } from './_lib';

const tmpRoots: string[] = [];
after(() => {
  for (const dir of tmpRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const ADAPTER = 'web-1/src/application/stripe/adapters/stripe.adapter.ts';
const UTILS = 'web-1/src/application/stripe/webhooks/stripe-webhooks.utils.ts';
const BASE: Record<string, string> = {
  [ADAPTER]:
    'export const getStripe = (): { x: () => number } => ({ x: () => 1 });\n',
  [ROUTER]:
    'export const routeStripeEvent = async (e: unknown, tx: unknown): Promise<unknown> => [e, tx];\n',
  [`${HANDLERS}/noop.handler.ts`]: 'export const noop = (): number => 0;\n',
  // A helper that reaches Stripe, so the call graph is never empty.
  [UTILS]: [
    "import { getStripe } from '../adapters/stripe.adapter';",
    'const fromPrice = (): number => getStripe().x();',
    'export const extractPlanId = (): number => fromPrice();',
    '',
  ].join('\n'),
  'main/src/keep.ts': 'export {};\n',
  '.shared-kernel/keep.ts': 'export {};\n',
};

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nf-stripe-'));
  tmpRoots.push(root);
  for (const [rel, text] of Object.entries({ ...BASE, ...files })) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
}

const messages = (check: CheckResult): string[] =>
  check.findings.map(f => `${f.file}:${f.line} ${f.message}`);

// ── claim-first ─────────────────────────────────────────────────────────────────────────────

const HOT = 'web-1/src/pages/api/v1/webhooks/stripe/index.ts';
const IMPORTS = [
  "import { routeStripeEvent } from '../../../../../application/stripe/webhooks/stripe-event-router';",
  "import { claimEventForProcessingTx } from '../../../../../application/stripe/webhooks/stripe-webhook-claim';",
  'declare const db: { $transaction: (fn: (tx: unknown) => Promise<void>) => Promise<void> };',
  'declare const event: { id: string };',
].join('\n');
const hot = (body: string): Record<string, string> => ({
  [HOT]: `${IMPORTS}\n${body}\n`,
});

void describe('stripe:claim-first', () => {
  void it('accepts the claim as the first statement of the tx callback', () => {
    const c = checkClaimFirst(
      tree(
        hot(`export const h = () => db.$transaction(async tx => {
  await claimEventForProcessingTx(tx, event.id);
  await routeStripeEvent(event, tx);
});`)
      )
    );
    assert.deepEqual(messages(c), []);
    assert.equal(c.sites, 1);
  });

  void it('rejects route before claim', () => {
    const c = checkClaimFirst(
      tree(
        hot(`export const h = () => db.$transaction(async tx => {
  await routeStripeEvent(event, tx);
  await claimEventForProcessingTx(tx, event.id);
});`)
      )
    );
    assert.equal(c.findings.length, 1);
  });

  void it('rejects a missing claim, and a claim named only in a comment or a string', () => {
    const c = checkClaimFirst(
      tree(
        hot(`export const h = () => db.$transaction(async tx => {
  // claimEventForProcessingTx(tx, event.id);
  const s = 'claimEventForProcessingTx(tx)';
  await routeStripeEvent(event, tx, s);
});`)
      )
    );
    assert.equal(c.findings.length, 1);
  });

  void it('rejects a claim that is not the FIRST statement (the line-order guard accepted it)', () => {
    const c = checkClaimFirst(
      tree(
        hot(`export const h = () => db.$transaction(async tx => {
  await Promise.resolve(tx);
  await claimEventForProcessingTx(tx, event.id);
  await routeStripeEvent(event, tx);
});`)
      )
    );
    assert.equal(c.findings.length, 1);
  });

  void it('rejects routing outside a $transaction callback even after a claim', () => {
    const c = checkClaimFirst(
      tree(
        hot(`export const h = async (tx: unknown) => {
  await claimEventForProcessingTx(tx, event.id);
  await routeStripeEvent(event, tx);
};`)
      )
    );
    assert.equal(c.findings.length, 1);
  });

  void it('sees router.routeStripeEvent() through a namespace import', () => {
    const c = checkClaimFirst(
      tree({
        [HOT]: `import * as router from '../../../../../application/stripe/webhooks/stripe-event-router';
import { claimEventForProcessingTx } from '../../../../../application/stripe/webhooks/stripe-webhook-claim';
declare const db: { $transaction: (fn: (tx: unknown) => Promise<void>) => Promise<void> };
declare const event: { id: string };
export const run = (): Promise<void> => db.$transaction(async tx => {
  await router.routeStripeEvent(tx, event);
  await claimEventForProcessingTx(tx, event.id);
});
`,
      })
    );
    assert.equal(c.sites, 1);
    assert.equal(c.findings.length, 1);
  });

  void it('follows an alias import of routeStripeEvent (the text guard did not)', () => {
    const c = checkClaimFirst(
      tree({
        [HOT]: `${IMPORTS.replace('{ routeStripeEvent }', '{ routeStripeEvent as route }')}
export const h = () => db.$transaction(async tx => { await route(event, tx); });
`,
      })
    );
    assert.equal(c.findings.length, 1);
  });

  void it('ignores prose: comments, strings and templates naming routeStripeEvent(', () => {
    const c = checkClaimFirst(
      tree(
        hot(`// routeStripeEvent(event, tx)
/* routeStripeEvent(event, tx) */
export const a = 'routeStripeEvent(event, tx)';
export const b = \`routeStripeEvent(\${a})\`;`)
      )
    );
    assert.deepEqual(messages(c), []);
    assert.equal(c.sites, 0);
  });

  void it('accepts claim-first-allow with a reason, rejects a bare marker', () => {
    const ok = checkClaimFirst(
      tree(
        hot(
          'export const h = (tx: unknown) => routeStripeEvent(event, tx); // claim-first-allow: replay tool, no tx'
        )
      )
    );
    assert.deepEqual(messages(ok), []);
    const bare = checkClaimFirst(
      tree(
        hot(
          'export const h = (tx: unknown) => routeStripeEvent(event, tx); // claim-first-allow:'
        )
      )
    );
    assert.equal(bare.findings.length, 1);
  });

  void it('skips the router that defines routeStripeEvent and asserts it exists', () => {
    const root = tree({});
    rmSync(path.join(root, ROUTER));
    assert.ok(checkClaimFirst(root).errors.length > 0);
  });
});

// ── no-api-in-tx ────────────────────────────────────────────────────────────────────────────

const H = `${HANDLERS}/x.handler.ts`;
const handler = (body: string): Record<string, string> => ({
  [H]: `import { getStripe } from '../../adapters/stripe.adapter';
import { extractPlanId } from '../stripe-webhooks.utils';
${body}
`,
});

void describe('stripe:no-api-in-tx', () => {
  void it('rejects getStripe() in a handler', () => {
    const c = checkNoApiInTx(
      tree(handler('export const h = (): number => getStripe().x();'))
    );
    assert.deepEqual(messages(c).length, 1);
  });

  void it('rejects getStripe() in the router', () => {
    const c = checkNoApiInTx(
      tree({
        [ROUTER]: `import { getStripe } from '../adapters/stripe.adapter';
export const routeStripeEvent = async (): Promise<number> => getStripe().x();
`,
      })
    );
    assert.equal(c.findings.length, 1);
  });

  void it('rejects a helper in the utils file that reaches Stripe (one hop)', () => {
    const c = checkNoApiInTx(
      tree(handler('export const h = (): number => extractPlanId();'))
    );
    assert.equal(c.findings.length, 1);
    assert.match(c.findings[0]?.message ?? '', /extractPlanId/);
  });

  void it('rejects a helper from ANY web-1 file, through an alias and two files deep', () => {
    const c = checkNoApiInTx(
      tree({
        'web-1/src/domain/billing/deep.ts': `import { getStripe as client } from '@app/stripe/adapters/stripe.adapter';
export function deep(): number { return client().x(); }
`,
        'web-1/src/domain/billing/mid.ts': `import { deep } from './deep';
export const mid = (): number => deep();
`,
        [H]: `import { mid as m } from '@domain/billing/mid';
export const h = (): number => m();
`,
      })
    );
    assert.equal(c.findings.length, 1);
  });

  void it('rejects a Stripe call inside a $transaction callback that routes an event', () => {
    const c = checkNoApiInTx(
      tree({
        'web-1/src/application/stripe/webhooks/janitor/j.ts': `import { getStripe } from '../../adapters/stripe.adapter';
import { routeStripeEvent } from '../stripe-event-router';
declare const db: { $transaction: (fn: (tx: unknown) => Promise<void>) => Promise<void> };
const fetchIt = (): number => getStripe().x();
export const outside = (): number => fetchIt();
export const j = () => db.$transaction(async tx => {
  fetchIt();
  await routeStripeEvent(1, tx);
});
`,
      })
    );
    assert.deepEqual(
      c.findings.map(f => f.line),
      [7]
    );
  });

  void it('accepts d2f1-allow with a reason up to three lines above, not four', () => {
    const ok = checkNoApiInTx(
      tree(
        handler(`// d2f1-allow: fallback for callers without prefetch
//
//
export const h = (): number => getStripe().x();`)
      )
    );
    assert.deepEqual(messages(ok), []);
    assert.equal(ok.sites, 1);
    const far = checkNoApiInTx(
      tree(
        handler(`// d2f1-allow: fallback for callers without prefetch
//
//
//
export const h = (): number => getStripe().x();`)
      )
    );
    assert.equal(far.findings.length, 1);
  });

  void it('rejects a bare d2f1-allow marker and a marker inside a string', () => {
    const bare = checkNoApiInTx(
      tree(
        handler(
          'export const h = (): number => getStripe().x(); // d2f1-allow:'
        )
      )
    );
    assert.match(bare.findings[0]?.message ?? '', /without a reason/);
    const str = checkNoApiInTx(
      tree(
        handler(
          "export const h = (): number => getStripe().x() + 'd2f1-allow: no'.length;"
        )
      )
    );
    assert.equal(str.findings.length, 1);
  });

  void it('an escaped getStripe() in a helper does not taint its callers', () => {
    const c = checkNoApiInTx(
      tree({
        [`${HANDLERS}/auto-cancel.utils.ts`]: `import { getStripe } from '../../adapters/stripe.adapter';
export const cancelOld = (): number => {
  // d2f1-allow: runs as a post-commit effect
  return getStripe().x();
};
`,
        [H]: `import { cancelOld } from './auto-cancel.utils';
export const h = (): number => cancelOld();
`,
      })
    );
    assert.deepEqual(messages(c), []);
    assert.equal(c.sites, 1);
  });

  void it('an escaped getStripe() in a helper OUTSIDE the scope still taints its callers', () => {
    const c = checkNoApiInTx(
      tree({
        'web-1/src/domain/billing/fallback.ts': `import { getStripe } from '@app/stripe/adapters/stripe.adapter';
export const fallback = (): number => {
  // d2f1-allow: documented fallback when the prefetch is absent
  return getStripe().x();
};
`,
        [H]: `import { fallback } from '@domain/billing/fallback';
export const h = (): number => fallback();
`,
      })
    );
    assert.equal(c.findings.length, 1);
    assert.match(
      c.findings[0]?.message ?? '',
      /fallback\(\) reaches the Stripe API/
    );
  });

  void it('sees property calls: adapter.getStripe() and ns.helper() through a namespace import', () => {
    const direct = checkNoApiInTx(
      tree({
        [H]: `import * as adapter from '../../adapters/stripe.adapter';
export const h = (): number => adapter.getStripe().x();
`,
      })
    );
    assert.equal(direct.findings.length, 1);
    const viaNs = checkNoApiInTx(
      tree({
        'web-1/src/domain/billing/deep.ts': `import { getStripe } from '@app/stripe/adapters/stripe.adapter';
export function deep(): number { return getStripe().x(); }
`,
        [H]: `import * as billing from '@domain/billing/deep';
export const h = (): number => billing.deep();
`,
      })
    );
    assert.equal(viaNs.findings.length, 1);
  });

  void it('follows re-exports: export { x } from and export * from', () => {
    for (const barrel of [
      "export { deep } from './deep';\n",
      "export * from './deep';\n",
    ]) {
      const c = checkNoApiInTx(
        tree({
          'web-1/src/domain/billing/deep.ts': `import { getStripe } from '@app/stripe/adapters/stripe.adapter';
export function deep(): number { return getStripe().x(); }
`,
          'web-1/src/domain/billing/index.ts': barrel,
          [H]: `import { deep } from '@domain/billing';
export const h = (): number => deep();
`,
        })
      );
      assert.equal(c.findings.length, 1, barrel);
    }
  });

  void it('a method call on a non-namespace object never resolves to a same-named helper', () => {
    const c = checkNoApiInTx(
      tree({
        'web-1/src/domain/billing/deep.ts': `import { getStripe } from '@app/stripe/adapters/stripe.adapter';
export function deep(): number { return getStripe().x(); }
`,
        [H]: `import { deep } from '@domain/billing/deep';
declare const obj: { deep(): number };
export const h = (): number => obj.deep();
export const keep = deep;
`,
      })
    );
    assert.deepEqual(messages(c), []);
  });

  void it('ignores prose naming getStripe() and the helpers', () => {
    const c = checkNoApiInTx(
      tree(
        handler(`// getStripe() and extractPlanId() are not called here
/* getStripe() */
export const a = 'getStripe()';
export const b = \`\${a} extractPlanId()\`;`)
      )
    );
    assert.deepEqual(messages(c), []);
    assert.equal(c.sites, 0);
  });

  void it('reports an empty call graph and a missing handlers root as errors', () => {
    const root = tree({
      [UTILS]: 'export const extractPlanId = (): number => 1;\n',
    });
    assert.ok(checkNoApiInTx(root).errors.length > 0);
    rmSync(path.join(root, HANDLERS), { recursive: true });
    assert.ok(checkNoApiInTx(root).errors.some(e => e.includes('handlers')));
  });
});

// ── scope (samples of tests/audit/_fixtures/stripe-scope, same verdicts) ───────────────────

const FIX = 'web-1/src/application/fixture';
const scopeOf = (name: string, text: string): CheckResult =>
  checkScope(tree({ [`${FIX}/${name}`]: text }));

void describe('stripe:scope', () => {
  void it('fixture must-fail/unscoped-subscriptions-list.ts', () => {
    const c = scopeOf(
      'unscoped-subscriptions-list.ts',
      `declare const stripe: {
  subscriptions: { list: (p: object) => Promise<unknown> };
};

export const scan = async (): Promise<unknown> =>
  stripe.subscriptions.list({ limit: 100 });
`
    );
    assert.match(c.findings[0]?.message ?? '', /UNSCOPED Stripe list-query/);
  });

  void it('fixture must-fail/bare-allow-marker.ts', () => {
    const c = scopeOf(
      'bare-allow-marker.ts',
      `declare const stripe: {
  subscriptions: { search: (p: object) => Promise<unknown> };
};

// stripe-scope-allow:
export const find = async (): Promise<unknown> =>
  stripe.subscriptions.search({ query: "status:'active'" });
`
    );
    assert.match(
      c.findings[0]?.message ?? '',
      /stripe-scope-allow without a reason/
    );
  });

  void it('fixture must-fail/scope-only-in-comment.ts', () => {
    const c = scopeOf(
      'scope-only-in-comment.ts',
      `declare const stripe: {
  prices: { list: (p: object) => Promise<unknown> };
};

// Filtered later with isScopedToNailfolio (but nothing here actually calls it).
export const load = async (): Promise<unknown> =>
  stripe.prices.list({ active: true });
`
    );
    assert.match(c.findings[0]?.message ?? '', /UNSCOPED Stripe list-query/);
  });

  void it('fixture must-pass/scoped-subscriptions-list.ts', () => {
    const c = scopeOf(
      'scoped-subscriptions-list.ts',
      `declare const stripe: {
  subscriptions: { list: (p: object) => Promise<{ data: { plan: string }[] }> };
};
declare const isScopedToNailfolio: (planId: string) => boolean;

export const scan = async (): Promise<string[]> => {
  const page = await stripe.subscriptions.list({ limit: 100 });
  return page.data.map(s => s.plan).filter(isScopedToNailfolio);
};
`
    );
    assert.deepEqual(messages(c), []);
    assert.equal(c.sites, 1);
  });

  void it('fixture must-pass/list-only-in-comment.ts', () => {
    const c = scopeOf(
      'list-only-in-comment.ts',
      `// The old code called stripe.subscriptions.list( here; it is gone now.
export const noop = (): number => 0;
`
    );
    assert.deepEqual(messages(c), []);
    assert.equal(c.sites, 0);
  });

  void it('fixture must-pass/allow-with-reason.ts', () => {
    const c = scopeOf(
      'allow-with-reason.ts',
      `declare const stripe: {
  subscriptions: { list: (p: object) => Promise<unknown> };
};

export const forCustomer = async (customer: string): Promise<unknown> =>
  // stripe-scope-allow: filtered by a customer id that only Nailfolio creates.
  stripe.subscriptions.list({ customer });
`
    );
    assert.deepEqual(messages(c), []);
  });

  void it('rejects a file that only IMPORTS isScopedToNailfolio (the text guard accepted it)', () => {
    const c = scopeOf(
      'import-only.ts',
      `import { isScopedToNailfolio } from '@kernel/x';
declare const stripe: { products: { list: () => Promise<unknown> } };
export const a = (): Promise<unknown> => stripe.products.list();
`
    );
    assert.equal(c.findings.length, 1);
  });

  void it('ignores list calls and the helper named in strings and templates', () => {
    const c = scopeOf(
      'strings.ts',
      "export const a = 'stripe.prices.list(';\nexport const b = `${a} stripe.subscriptions.search(`;\n"
    );
    assert.equal(c.sites, 0);
    const d = scopeOf(
      'helper-in-string.ts',
      `declare const stripe: { prices: { list: () => Promise<unknown> } };
export const a = (): unknown => [stripe.prices.list(), 'isScopedToNailfolio'];
`
    );
    assert.equal(d.findings.length, 1);
  });

  void it('a stripe-scope-allow marker in a string does not escape', () => {
    const c = scopeOf(
      'marker-in-string.ts',
      `declare const stripe: { prices: { list: () => Promise<unknown> } };
export const a = (): unknown => [stripe.prices.list(), 'stripe-scope-allow: nope'];
`
    );
    assert.equal(c.findings.length, 1);
  });
});

// ── ui-mode ─────────────────────────────────────────────────────────────────────────────────

void describe('stripe:ui-mode', () => {
  const ui = (rel: string, text: string): CheckResult =>
    checkUiMode(tree({ [rel]: text }));

  void it('accepts custom in code and in comments', () => {
    const c = ui(
      'web-1/src/a.ts',
      "// ui_mode:'custom'\nexport const p = { ui_mode: 'custom' as const };\n"
    );
    assert.deepEqual(messages(c), []);
    assert.equal(c.sites, 2);
  });

  void it("rejects 'embedded', 'elements' and 'hosted' in code across the three roots", () => {
    assert.equal(
      ui('web-1/src/a.ts', "export const p = { ui_mode: 'embedded' };\n")
        .findings.length,
      1
    );
    assert.equal(
      ui('main/src/a.tsx', 'export const p = { ui_mode: "elements" };\n')
        .findings.length,
      1
    );
    assert.equal(
      ui('.shared-kernel/a.ts', "export const p = { 'ui_mode': 'hosted' };\n")
        .findings.length,
      1
    );
  });

  void it('rejects a stale value in a comment (read on purpose)', () => {
    assert.equal(
      ui('web-1/src/a.ts', "/* uses ui_mode: 'elements' */\nexport {};\n")
        .findings.length,
      1
    );
  });

  void it('rejects a non-literal ui_mode value (the text guard could not see it)', () => {
    const c = ui(
      'web-1/src/a.ts',
      "declare const m: 'custom' | 'embedded';\nexport const p = { ui_mode: m };\n"
    );
    assert.equal(c.findings.length, 1);
  });

  void it('skips the READONLY kernel copy', () => {
    const c = ui(
      'web-1/src/READONLY-shared-kernel/a.ts',
      "export const p = { ui_mode: 'embedded' };\n"
    );
    assert.deepEqual(messages(c), []);
  });
});
