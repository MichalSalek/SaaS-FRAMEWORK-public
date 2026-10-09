# Testing Architecture

> **Nawigacja:** Ten dokument | **Strategia:** [docs/TESTS/README.md](../docs/TESTS/README.md)

---

## Structure

```
tests/
  run-smoke-tests.ts             # Tier 1 orchestrator: imports & runs smoke/*.smoke.ts
  dto-generator.test.ts          # Tier 0: DTO generator golden snapshot test
  __snapshots__/
    db_models.generated.dto.ts.snap  # Golden snapshot (committed, update intentionally)
  smoke/                         # Modular smoke test suites (*.smoke.ts) — runner importuje je JAWNIE
    _setup.ts                    # Token acquisition, cleanup
    _test-utils.ts               # Shared types, test wrapper, assertions
    _rbac-matrix.ts              # SSOT-driven RBAC permission verification
    auth.smoke.ts                # Auth endpoints (dev-login, providers, session)
    user.smoke.ts                # User management (name, role, onboard, state)
    account.smoke.ts             # Account ops (vanity URL, location, payment)
    gallery.smoke.ts             # Gallery CRUD, colors, traits, explore
    admin.smoke.ts               # Admin endpoints (users, flags, metrics, bulk)
    ...                          # + kolejne moduły domenowe i *-contract.smoke.ts (licznik nie hardcodowany)
                                 # ⚠️ NOWY plik smoke NIE zaczyna biegać sam — dopisz import
                                 #    w run-smoke-tests.ts (statyczna lista, nie glob)
  concurrency/                   # Live race suite (real HTTP races + SQL assertions) — patrz concurrency/README.md
  e2e/                           # Playwright browser smoke (specs/, helpers/) — patrz e2e/README.md
  preflight.ts                   # `npm run test:preflight` — gotowość stacku przed smoke/e2e
  utils/
    api-client.ts                # HTTP client, tokens, assertions
    backend-env.ts               # SSOT resolver: base URLs/secrets/identities z web-1/.env.development (no duplicated URLs)
    coverage-checker.ts          # Coverage gap detection (ROUTES_API vs smoke tests)
    db-client.ts                 # Direct Postgres client dla asercji concurrency-suite
    test-data-setup.ts           # Setup & cleanup helpers
    generate-context-snapshot.ts # AI QA context generator
  config/test.config.ts          # Environment config
  audit/                         # SSOT compliance audits
  # AI QA: /testy-api skill (.claude/skills/testy-api/)
```

## CI / Pre-commit Status

> **NOTE (process, nie bug):** Smoke tests (`tests/smoke/`) and E2E Playwright tests (`tests/e2e/`) are **MANUAL-only**. They are NOT wired into pre-commit hooks and NOT run by `pr-check.yml` or any CI pipeline. Running them requires a live dev stack (backend + frontend + DB). **Before every release, run both manually:**
>
> ```bash
> npm run test:smoke       # API-level smoke (from repo root)
> npm run test:e2e         # Browser-level E2E (requires npm run dev first)
> ```
>
> The pre-commit hook runs static gates only: the audits matching the staged paths, `npm audit` and `tsc` (`scripts/hooks/pre-commit`). The pre-push hook runs the full audit suite plus `tsc`, ESLint on the pushed diff and the Vitest unit suites (`scripts/hooks/pre-push`). **Vitest unit suites DO run in CI** (since 2026-07-16, commit `5cc5da0`): `pr-check.yml` has dedicated web-1 + main `test:unit` jobs, and `scripts/deploy/deploy-backend`/`deploy-frontend` run a PHASE 0 pre-flight (typecheck + test:unit) before deploy. CI integration of smoke+e2e is deferred — see `tests/e2e/README.md` TODO section.

---

## Test Tiers

### Tier 0.5: Vitest Unit + Integration-Handler (web-1, no live server)
**Purpose:** Pure backend logic (policies, resolvers, domain config) + handler-level integration with mocked IO (`node-mocks-http` + `vi.mock('@app/...')`)
**Run:** `npm run test:unit` (from `web-1/`) — seconds, no DB/network; current file/test counts are whatever the run prints (deliberately not hardcoded — the suite grows)

Added in BDX FAZA 0. Config: `web-1/vitest.config.ts` (node env, `@kernel`/`@app`/`@domain` aliases mirror tsconfig so mocks intercept the same files handlers import). Covers e.g. the DB-failure path (`db-error-path.test.ts` → 500 GENERAL_ERROR opaque), pairing claim, dunning resolver, archetype queries, method-guard. `npm run test:unit:watch` for TDD, `:coverage` for v8 coverage.

### Tier 1: Smoke Tests (Manual gate before release)
**Purpose:** Fast validation of critical paths + security (API-level, live stack)
**Run:** `npm run test:smoke`

Covers: auth, session, user CRUD, gallery CRUD, favorites, pairing full flow, RBAC matrix (SSOT-driven), validation negative tests, pricing limits, user lifecycle.

### Tier 1.5: Live Concurrency Suite (Manual, live backend + DB)
**Purpose:** Real parallel HTTP races with assertions **directly on Postgres** — łapie bugi jednego efektu (counter drift, lost write, deadlock ABBA, torn state), których „brak 500" nie ujawnia. Pin do fixów epiku DB-hardening.
**Run:** `npm run test:concurrency` (root lub `tests/`) — wymaga żywego dev backendu + osiągalnego Postgresa; NIE jest częścią `run-all.sh` ani pre-commita.

Szczegóły (rodziny testów, harness, fixtures): [`tests/concurrency/README.md`](concurrency/README.md).

### Tier 0: DTO Generator Snapshot (No server required)
**Purpose:** Protect against Prisma (v7) breaking syntax or `@mrleebo/prisma-ast` API changes that silently produce wrong generated DTOs.
**Run:** `npm run test:dto-generator` (from repo root)

How it works:
1. Runs `npm run system:generate-dto` (regenerates `.shared-kernel/models/db_models.generated.dto.ts`)
2. Compares output byte-for-byte with `tests/__snapshots__/db_models.generated.dto.ts.snap`
3. FAIL on any diff — diff is never auto-accepted

When to update the snapshot (only for intentional schema changes):
```bash
cp .shared-kernel/models/db_models.generated.dto.ts tests/__snapshots__/db_models.generated.dto.ts.snap
# Then commit both files
```

No server required. No env vars needed. Runs in ~5 seconds.

### AI Agent (Manual, on-demand)
**Purpose:** Multi-user stateful flows, cross-domain side effects, temporal attacks, cascade verification, edge case exploration — things automation can't cover
**Skill:** `/testy-api` (protokol: `.claude/skills/testy-api/protocol.md`)
**Does NOT duplicate:** Tier 1 happy paths

## SSOT Sources (kernel — no duplicate specs)

| Data | Location |
|------|----------|
| Endpoints | `.shared-kernel/domain/routing/routing.config.ts` (ROUTES_API) |
| Permissions | `web-1/src/application/permissions/permissions.config.ts` |
| Validators | `.shared-kernel/policies/validation.policy.ts` (barrel) + `validation/*.validation.ts` (zod przez `validation.zod.ts`) |
| HTTP methods | `.shared-kernel/domain/http/http-methods.config.ts` (`API_HTTP_METHODS` = SSOT; `contestedHTTPMethod:` w handlerze tylko dla tras RAW/webhook) |
| Pricing limits | `.shared-kernel/policies/pricing.policy.ts` |
| Test users | `.shared-kernel/config/test-users.config.ts` |

## Quick Start

```bash
cd tests

# Tier 1: Smoke tests
npm run test:smoke

# Coverage report
npm run test:coverage

# TypeScript check
npm run typecheck
```

## Adding Tests for a New Endpoint

1. Add smoke test in `smoke/[domain].smoke.ts` (happy path + negative)
2. **Wire it up:** dopisz jawny `import './smoke/[domain].smoke'` w `run-smoke-tests.ts` — runner ma statyczną listę, nie glob. Bez tego kroku plik nigdy nie pobiegnie
3. Coverage checker (`utils/coverage-checker.ts`) skanuje katalog `smoke/` sam (`readdirSync`) — raport pokrycia zobaczy plik nawet zanim go podepniesz, więc „✅ w coverage" ≠ „biegnie w suicie"
4. Edge cases: `/testy-api` skill explores dynamically (reads kernel validators at runtime)

## Best Practices

- Use DTO types from shared-kernel for type safety
- Dynamic test data (timestamps, random IDs)
- Always clean up: `try/finally` for created test data
- Save-and-restore for mutation tests (rollback original values)
- No `any` types — TypeScript strict mode = static tests

### A mock can hide a mechanism that is dead in production

Real case (2026-07-12 → 2026-08-20, web-1 `2405e150`): `acquireAdvisoryXactLock` threw on
**every** call in production — `pg_advisory_xact_lock()` returns SQL `void`, which the Prisma
driver-adapter cannot deserialize — so subscription activation, plan grant and cancellation all
answered 500 for over a month while Stripe retried into the same wall.

The full gate stack stayed green throughout, because **no layer that was green actually ran the
broken code**: handler unit tests `vi.mock` that function (they assert it was *called*, not that
it *works*), the concurrency suite talked to Postgres through raw `pg` (which decodes `void`
fine), and static audits cannot see a runtime deserialization error.

So when a gate guards a money/auth hot path, ask: **does this test hit the same stack production
hits?** Mocking the thing you are guarding turns the gate into a check that the call site still
compiles. The regression gate that finally pins this (`tests/concurrency/advisory-xact-lock.concurrency.ts`,
family 7) builds a real `PrismaPg` client over a `pg` pool, exactly like the app does, and imports
the production function rather than a copy of its SQL.

---

**Last Updated:** 2026-08-31 (standup S14: dopisana lekcja „a mock can hide a mechanism that is dead in production" — bug advisory-locka Stripe żył miesiąc pod zielonymi bramkami; `utils/` uzupełnione o `backend-env.ts`/`db-client.ts`) · 2026-08-02 (doc-drift: HTTP-methods SSOT → kernel `http-methods.config.ts`, Prisma v7, dopisany Tier 1.5 concurrency + `preflight.ts`/`e2e/` w strukturze; sprostowane „auto-discovery" smoke — runner ma statyczną listę importów, auto-skanuje tylko coverage-checker)
