# Backend API (web-1)

> 📍 **Nawigacja:** Ten dokument | **API SSOT:** `.shared-kernel/domain/routing/routing.config.ts`

Backend API module built with Next.js.

## Stack

- **Framework:** Next.js (Pages Router)
- **Language:** TypeScript (strict mode, `noUncheckedIndexedAccess` ON)
- **Database:** PostgreSQL (Neon) + Prisma ORM v7 with the `@prisma/adapter-pg` driver adapter (direct-Prisma via `DB_CLIENT.use`, no repository layer — DECISION D1)
- **Auth:** Better Auth v1.6+ (bearer plugin, magic-link plugin, Apple feature-flagged)
- **Pattern:** RESTful + light CQRS (`OperationResult` envelope)
- **Handlers:** unified `defineHandler` (CQRS) + `withPublicHandler`/`withRawSecretHandler` (raw/webhook) — see Handler Convention below
- **Env:** governed via `environment.config.ts` → `env-schema.ts` (validated on startup) → typed `ENV_VARS`; zero raw `process.env.X`
- **Imports:** `@kernel/*` · `@app/*` · `@domain/*` path aliases (no deep-relative)
- **Tests:** TSC strict + Vitest unit/integration-handler (no live server; licznik celowo nie hardcodowany — SSOT = wynik `npm run test:unit`)

## Quick Start

Sprawdź dostępne skrypty w [web-1/package.json](package.json).

## Automatic Smoke Tests on Startup

Backend can automatically run smoke tests after startup and seeding:

Ustaw `RUN_SMOKE_TESTS_ON_STARTUP=true` w `web-1/.env.development`.

**Gdzie działa:** runner (`src/application/startup/smoke-tests-runner.ts`) potrzebuje katalogu `tests/`
obok aplikacji — szuka `/tests/package.json`, potem `./tests/package.json`. W Dockerze DEV i PROD
katalog jest bind-mountowany (`./tests:/tests` w `docker-compose.dev.yml` / `docker-compose.prod.yml`),
więc tam **działa**. Na deployach Render-style testy nie jadą w artefakcie → runner **grzecznie się
pomija** z logiem „tests directory not found", zamiast wywalać boot.

**How it works:**

- Tests run ~15 s after startup + seeding (`SMOKE_TESTS_DELAY`; wolniejszy sprzęt w standalone potrzebuje zapasu)
- Non-blocking (app starts immediately); twardy timeout 10 min na całą suitę
- Wynik ma trzy rozłączne stany: 🟢 wszystko OK · 🟡 tylko znane środowiskowe/flaky (limit Mailguna, timing rate-limitu, zużyta quota) — **nie** regresja · 🔴 realna regresja
- Crash/timeout bez parsowalnego podsumowania raportowany osobno od „testy failują" (żeby `exit(1)` z dwóch testów nie był mylony z „APPLICATION BROKEN")
- Failures logged to EventLog for monitoring

**When to enable:**

- Docker DEV/staging: catch regressions right after seeding
- Preview: verify deployment health przed przełączeniem ruchu

**Disable if:**

- High-traffic production (run tests manually)
- Środowisko bez katalogu `tests/` — flaga i tak jest wtedy no-opem

## Database Migration Workflow

Two Prisma schemas: **main** (`src/prisma/schema.prisma`) and **event log** (`src/prisma-app-logs/schema.prisma`).

### DEVELOPMENT (Docker)

```bash
# Schema change:
1. Edit schema.prisma
2. docker exec web-1-dev npm run db:migrate:dev       # creates migration + applies
3. Git commit migration.sql + migration_lock.toml

# Prototyping (quick experiments without migration files):
1. Edit schema.prisma
2. docker exec web-1-dev npm run db:push:safe          # applies schema directly
3. When ready: docker exec web-1-dev npm run db:migrate:dev  # creates migration from diff

# Reset dev DB (conscious data loss):
1. docker exec web-1-dev npm run db:reset
2. Restart container (seeding via instrumentation.ts)
```

### STAGING (staging host)

Staging uses `prisma migrate deploy` (safe, preserves data). Handled automatically by `docker-entrypoint.sh` when `NODE_ENV_MANUAL=STAGING`.

### PREVIEW DEPLOY (Render, manual)

```bash
npm run preview db:migrate:prod                         # main schema
npm run preview db:migrate:prod:logs                    # event log (if changed)
# Then deploy backend
```

### PRODUCTION DEPLOY (Render, manual)

```bash
npm run production db:migrate:prod                      # main schema
npm run production db:migrate:prod:logs                 # event log (if changed)
# Then deploy backend
```

### Gotcha: NO `CONCURRENTLY` in migration files

`prisma migrate deploy` runs each migration file inside ONE transaction, and Postgres rejects
`CREATE/DROP INDEX CONCURRENTLY` inside a transaction — this killed the Render build twice on
2026-07-19 (`build_failed`, prod stayed on the previous artifact). Write plain
`CREATE INDEX` in the migration; if a live prod table is too big for a transactional build,
create the index by hand (CONCURRENTLY, outside a transaction) and mark the migration
`db:migrate:resolve -- <name>`. Worked example + DECISION comment:
`src/prisma/migrations/20260719_optimize_hot_read_indexes/migration.sql`.

### First deploy after baseline regeneration

On each existing database (dev, staging, preview, production), mark the new baseline as already applied:

```bash
npm run [env] db:migrate:resolve -- 0_current_baseline
npm run [env] db:migrate:resolve:logs -- 0_current_baseline
```

### Key Scripts

| Script               | Purpose                                                  |
| -------------------- | -------------------------------------------------------- |
| `db:push:safe`       | Apply schema without migration file (no data loss flags) |
| `db:migrate:dev`     | Create + apply migration (dev)                           |
| `db:migrate:prod`    | Apply pending migrations (deploy)                        |
| `db:migrate:resolve` | Mark migration as applied                                |
| `db:reset`           | Reset DB + re-apply all migrations                       |
| `db:status`          | Check migration status                                   |
| `db:studio`          | Open Prisma Studio (port 5555)                           |

Full script list: [web-1/package.json](package.json).

## Email Lifecycle

Automated email system for trial sequences, cancel flows, and transactional emails.

- **Sweep Interceptor:** Lazy evaluation (no cron) — runs on API usage with a throttle + quiet-hours window, batch processing, EventLog dedup. Concrete numbers live in `EMAIL_SWEEP_TUNING` (`.shared-kernel/domain/email/email-schedule.config.ts`): `SWEEP_THROTTLE_MS` = 6h, `QUIET_HOURS_START`/`QUIET_HOURS_END` **w UTC** (obecnie 21→9) — czytaj config, nie ten akapit
- **Templates:** SSOT `src/application/email-handler/email-template.bodies.ts` (BODY_TEMPLATES: welcome + magic-link + trial + dunning + cancel/winback + transactional/lifecycle). Licznik NIE hardcodowany (rot-prone) — policz klucze w pliku. Table-based HTML with inline styles, i18n PL/EN/DE
- **Transport:** Resend primary (gdy `RESEND_API_KEY`) → Mailgun fallback → SMTP fallback (automatic failover)
- **Unsubscribe:** HMAC-signed stateless tokens (SHA-256, timing-safe). Public endpoint, no login required
- **Preferences:** Per StylistAccount: `trial_sequence`, `marketing` (opt-out). Transactional always on
- **Config:** `.shared-kernel/domain/email/email-schedule.config.ts` (SSOT for all schedules + `EMAIL_SWEEP_TUNING`); czysto-domenowe resolvery/pętle sweepów → `web-1/src/domain/email/`
- **Env var:** `EMAIL_UNSUBSCRIBE_SECRET` (HMAC signing key)

Spec: [EMAIL_LIFECYCLE.md](../docs/DOMAIN/product/EMAIL_LIFECYCLE.md)

## Auth

Backend uses **Better Auth v1.6+**.

- **Plugins:** `bearer` (Authorization header — first-class Capacitor/WebView support), `magicLink`, `apple` (feature-flagged via `APPLE_*` env vars)
- **Session transport:** `Authorization: Bearer <token>` header. The frontend stores the token in localStorage and reads no cookie; Better Auth core still sets a `session_token` cookie at sign-in, which the frontend ignores (`cookieCache` is off, see `better-auth.config.ts`).
- **Session model:** `Session.token` (renamed from `sessionToken`; kolumna w DB = `session_token` via `@map`)
- **Custom impersonation:** Not migrated to `admin()` plugin — preserved as custom implementation
- **Env vars:** `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (backend, np. api.nailfolio.app), `PUBLIC_URL` (FRONT, np. nailfolio.app, trustedOrigins/Stripe), `EMAIL_UNSUBSCRIBE_SECRET`
- **Removed:** `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `/api/v1/session/refresh` endpoint, `sessionsGarbageCollector` (Better Auth rejects expired sessions on read but does not delete the rows; `expired-session-cleanup-interceptor.ts` sweeps them)
- **Apple (optional):** `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_APP_BUNDLE_IDENTIFIER`

## Architecture

- **CQRS:** Command Query Responsibility Segregation
- **DDD:** Domain-Driven Design
- **Shared-Kernel:** SSOT dla typów i konfiguracji ([.shared-kernel/](../.shared-kernel/))
- **Direct-Prisma:** Dostęp przez `DB_CLIENT.use.<model>` (brak warstwy repository — DECISION w `src/application/db/db.client.ts`)
- **DB availability (Neon scale-to-zero):** ZERO aktywnego probingu bazy — cykliczny `SELECT 1` trzymałby compute Neona wiecznie obudzony. Zamiast tego pasywny obserwator poola (`src/application/db/db-availability.state.ts`): release bez błędu łączności = `up`, wyłącznie strukturalnie sklasyfikowany connectivity-error = `down` (błąd zapytania/constraintu dowodzi, że serwer odpowiedział → nie przewraca stanu). Snapshot czyta `/api/v1/internal/health-public` (status page + Better Stack); `pages/api/health/database.ts` to **pasywny alias** tego endpointu (re-export, zero własnego SQL — DECISION w pliku: stabilna ścieżka dla monitora, stary deploy zwraca uczciwe 404). Stan żyje na `globalThis` — Next bunduje ten moduł osobno dla `instrumentation.ts` i dla `pages/api`, więc module-level `let` dawał dwie niezależne kopie (fałszywe `database:down`). Zakłada JEDNĄ instancję Rendera (repliki wymagałyby monitora per-replika).
- **Graceful shutdown:** `src/instrumentation.ts` przechwytuje SIGTERM/SIGINT i **drenuje zaległe `runAfterResponse`** (`drainAfterResponseTasks`, bounded 10 s) PRZED flushem log-buffera i kolejki PostHoga oraz rozłączeniem DB. SIGTERM leci przy KAŻDYM redeployu Rendera — bez drenażu fire-and-forget (sweepy, tracking, event-log) ginęłoby w połowie.

**API SSOT:** Routes → `.shared-kernel/domain/routing/routing.config.ts` | Methods → `.shared-kernel/domain/http/http-methods.config.ts` | Handlers → `src/pages/api/v1/`

## Handler Convention (BDX)

Every `pages/api/v1` route funnels through ONE sanctioned wrapper (ratchet `audit:handler-shape`):

- **`defineHandler`** (`src/application/http/define-handler.ts`) — the default for CQRS command/query handlers (SSOT liczby tras: `.shared-kernel/domain/routing/routing.config.ts`; nie hardcodujemy licznika). Wires method-guard, permissions, validation, currentUser, error-mapper.
- **`withPublicHandler` / `withRawSecretHandler`** — raw/internal/webhook routes (no CQRS envelope), e.g. crawler tracking, Stripe webhook.
- Small auth allowlist calls `HTTPRequestHandlerMiddleware` directly (multi-method / token-public, by design).

Domain operations returning `OperationResult` carry the `_IO` suffix (ratchet `audit:operation-io-suffix`); DB-throw failures route through `databaseFailure()` (ratchet `audit:database-failure`).

**Env schema:** `src/application/environment/` — `environment.config.ts` (RAW_VARS registry) → `env-schema.ts` (validated on startup) → typed `ENV_VARS`. New vars must be registered there; raw `process.env.X` is blocked by `audit:env-governance`.

**File/naming:** kebab-case basenames in `application/`+`domain/` (`audit:naming-case`); imports via `@kernel`/`@app`/`@domain` aliases, not deep-relative (`audit:import-aliases`).

> **Deep DX guide** (handler anatomy, adding an endpoint, suffix conventions): [`docs/BACKEND_DX_GUIDE.md`](../docs/BACKEND_DX_GUIDE.md).

## Internal Architecture Docs

- [`src/application/README.md`](src/application/README.md) — CQRS, handlers, guards
- [`src/domain/README.md`](src/domain/README.md) — DDD aggregates, events
- Routing SSOT: `../.shared-kernel/domain/routing/routing.config.ts`
- [`DOCKER_ENTRYPOINT_README.md`](DOCKER_ENTRYPOINT_README.md) — Docker entrypoint
