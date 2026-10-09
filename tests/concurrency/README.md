# Live concurrency suite (KROK 4 — DB hardening)

LIVE-backend race tests that prove the concurrency hardening (epic `gleaming-tumbling-puddle`
— plan file archived after completion, no longer under `docs/PLANS_TODO/`).
Unlike the mock-DB unit tests, these fire **real HTTP races against the running dev backend**
and **assert directly on Postgres** afterwards — the only way to catch one-effect bugs
(counter drift, lost write, deadlock leak, torn state) that "no 500" hides.

The primitives under test live in `web-1/src/application/db/` (`cas.ts`, `with-write-tx.ts`,
`lock-rows.ts`, `serialization-conflict.ts`, `prisma-error.ts`). Only `prisma-error.ts` has a
mock-level Vitest sibling (`prisma-error.test.ts`) — the lock ordering and CAS behaviour of the
rest is provable ONLY here, against a real Postgres. See `tests/BACKEND_TESTING.md` for the
mock-level layer.

## Run

```bash
cd tests && npm run test:concurrency        # from repo root: npm run test:concurrency (mirror script)
```

Requires: dev backend UP + Postgres reachable — verify first with `cd tests && npm run test:preflight`
(resolves URL/secret/origin from `web-1/.env.development`, then dev-logins every role).

NOT part of `run-all.sh` / pre-commit / CI (`.github/workflows/pr-check.yml` runs lint,
typecheck, `audit:all` and Vitest only — all static or mock). Manual-only, by design:
this suite needs a live server AND a live database. Needs `pg` (in `tests/devDependencies`).

## Shape

- `run-concurrency.ts` — orchestrator: sweeps stale `conc-%` leftovers from crashed runs,
  imports every family (registration side-effect), runs once, tears down (fixture cleanup →
  close pool) in `finally` regardless of pass/fail, exits non-zero on any failure.
  This import list is the SSOT for which families exist.
- `_harness.ts` — dependency-free runner (NOT vitest): `test(name, fn, guards?)` + assertions
  (`assertEqual`/`assertTrue`/`assertOneOf`/`assertNo500`/`countStatuses`). Tests run
  SEQUENTIALLY — the parallelism lives INSIDE a test, in the race it fires.
- `_fixtures.ts` — ephemeral `conc-` users (dev-login for real tokens; SQL-insert for clients)
  + SQL source-data seeders + DB readers + RUN_MARKER-scoped cleanup (CASCADE).
- `../utils/db-client.ts` — pg pool (derives DATABASE_URL from `web-1/.env.development`,
  host-remaps `db:5432`→`localhost:3200`; `TEST_DATABASE_URL` overrides and is never
  rewritten), the `cached_X == live_count(X)` invariant (exact SQL from
  `web-1/src/application/startup/cached-counts-backfill.ts` — 3 derived counts only),
  and the `holdRowLock` / `isPgConcurrencyError` pg-probe pair.
- `../utils/api-client.ts` — `apiCallRaw` (gated setup + 429 backoff) and `fireParallel`
  (start-barrier true-parallel race burst; waits for rate-limit-window headroom before the
  synchronized release so bursts never saturate the server's 100/10s bucket).

## Families — each pins a shipped fix with RED-pre-fix / GREEN-post intent

(Count deliberately not hardcoded here — the live list is the import block in `run-concurrency.ts`.)

| File | Bug class | Guards |
|---|---|---|
| `active-pair.concurrency.ts` | SessionContainer partial-unique (parallel create idempotent) | session-container-2 |
| `gallery-delete-moderation.concurrency.ts` | ABBA 40P01 (SA-first lock) + **gallery-count double-decrement** | ioA-1, gallery-count-double-decrement |
| `ban-user-state.concurrency.ts` | BAN ⊥ disable User-first + **disabled_at idempotency** | ban-user-state-1/2 |
| `free-select-webhook.concurrency.ts` | selectFreePlan CAS ⊥ webhook | ioA-2 |
| `bookmark-cascade.concurrency.ts` | client hard-delete counter cascade | CWT-1/ioA-3 |
| `p2025-mapping.concurrency.ts` | P2025 → mapped 4xx/idempotent, never 500 | p2025-* |
| `advisory-xact-lock.concurrency.ts` | `acquireAdvisoryXactLock` `void`-column deserialization abort (Stripe webhook tx) + genuine serialization | family-7 |

Two fixes were FOUND by building this suite: `gallery-count-double-decrement` (deleting a
hidden record double-decremented the visible-count counter — RED proof captured) and the
BAN `disabled_at` overwrite. Both are guarded by deterministic tests here.
