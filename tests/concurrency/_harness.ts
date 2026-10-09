// tests/concurrency/_harness.ts
//
// Minimal self-contained runner for the LIVE concurrency suite. NOT vitest:
// these tests need a real running backend + real Postgres (ATI-4), and they
// assert on rows AFTER a real HTTP race — a mock-DB unit test cannot see the
// bug class this suite exists to catch. Kept dependency-free (mirrors the
// hand-rolled smoke runner) so `tsx run-concurrency.ts` is the only entrypoint.
//
// Each test() is run SEQUENTIALLY (the parallelism lives INSIDE a test — the
// race it fires), with isolated per-test fixtures, so one family's leftover
// rows never leak into another's invariant assertion.

export type TestFn = () => Promise<void>;

type RegisteredTest = {
  name: string;
  fn: TestFn;
  /** Tag a test as the RED/GREEN guard for a migrated bug (printed in report). */
  guards?: string;
};

const tests: RegisteredTest[] = [];

/** Register a concurrency test. `guards` documents which migrated bug it pins. */
export const test = (name: string, fn: TestFn, guards?: string): void => {
  tests.push(guards !== undefined ? { name, fn, guards } : { name, fn });
};

// --- assertions (throw on failure; the runner catches & marks ❌) ------------

export const assertEqual = <T>(actual: T, expected: T, msg?: string): void => {
  if (actual !== expected) {
    throw new Error(
      `${msg ? msg + ': ' : ''}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
};

export const assertTrue = (cond: boolean, msg: string): void => {
  if (!cond) {
    throw new Error(msg);
  }
};

export const assertOneOf = (actual: number, allowed: number[], msg?: string): void => {
  if (!allowed.includes(actual)) {
    throw new Error(
      `${msg ? msg + ': ' : ''}expected one of [${allowed.join(', ')}], got ${actual}`
    );
  }
};

/** Tally HTTP statuses from a fireParallel result for compact assertions. */
export const countStatuses = (
  responses: { status: number }[]
): Record<number, number> => {
  const out: Record<number, number> = {};
  for (const r of responses) {
    out[r.status] = (out[r.status] ?? 0) + 1;
  }
  return out;
};

/** Assert NO response was a 500 (race must never produce a server error). */
export const assertNo500 = (
  responses: { status: number; body?: unknown }[]
): void => {
  const five = responses.filter(r => r.status >= 500);
  if (five.length > 0) {
    throw new Error(
      `expected zero 5xx, got ${five.length}: ${JSON.stringify(five.map(r => ({ s: r.status, b: r.body })).slice(0, 3))}`
    );
  }
};

// --- runner ------------------------------------------------------------------

/**
 * Run every registered test SEQUENTIALLY. Returns true iff all passed. Does NOT
 * close the DB pool and does NOT call process.exit — the orchestrator
 * (run-concurrency.ts) owns teardown so cleanup runs deterministically even on
 * failure. Designed so each family file only registers tests (import side-effect)
 * and the orchestrator decides the lifecycle.
 */
export const runRegistered = async (suiteName: string): Promise<boolean> => {
  console.log(`\n🏁 Concurrency suite: ${suiteName}\n${'─'.repeat(60)}`);
  let passed = 0;
  let failed = 0;
  const failures: { name: string; error: string }[] = [];

  for (const t of tests) {
    const label = t.guards ? `${t.name}  [guards: ${t.guards}]` : t.name;
    try {
      await t.fn();
      passed++;
      console.log(`✅ ${label}`);
    } catch (e) {
      failed++;
      const error = e instanceof Error ? (e.stack ?? e.message) : String(e);
      failures.push({ name: t.name, error });
      console.log(`❌ ${label}\n   ${error.split('\n').slice(0, 4).join('\n   ')}`);
    }
  }

  console.log(`${'─'.repeat(60)}\n${passed} passed, ${failed} failed of ${tests.length}\n`);
  if (failures.length > 0) {
    console.error('Failures:');
    for (const f of failures) {
      console.error(`  • ${f.name}`);
    }
  }
  return failed === 0;
};
