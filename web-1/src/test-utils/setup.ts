/**
 * Global Vitest setup for web-1 backend tests (BDX FAZA 0, plan W0.1).
 *
 * WHY THIS FILE EXISTS
 * ────────────────────
 * Integration-handler tests import a real Next.js API handler (its default export)
 * and drive it through the production `HTTPRequestHandlerMiddleware`. That import
 * chain pulls in modules with heavy import-time side effects that have no place in a
 * unit test process:
 *   - `@app/db/db.client` → `prisma.adapter` constructs a live `PrismaClient` +
 *     `PrismaPg` adapter on module load (real DB connection config).
 *   - `getCurrentUser_IO` (user-session.operations) → `better-auth.config` builds the
 *     whole Better Auth instance (Stripe, Mailgun, magic-link adapters, …).
 *   - `runAfterResponse` → fires the cleanup interceptors + audit writes as floating
 *     promises (DB I/O after the response).
 *
 * We replace exactly these chokepoints with configurable mocks so a handler can be
 * imported and exercised WITHOUT a database, auth provider, or network. Everything
 * else (CORS, rate-limit, validation, permission config lookup, error mapping,
 * response envelope) runs for real — that is the point: we assert the true contract.
 *
 * PURE-POLICY TESTS are unaffected: they import kernel policies directly and never
 * touch these modules, so the mocks are inert for them.
 *
 * CONFIGURABILITY (per-test)
 * ──────────────────────────
 * The mocks read their behavior from a shared, mutable holder created via
 * `vi.hoisted()` (so it exists before the hoisted `vi.mock` factories run). Tests
 * tune behavior through the helpers re-exported from `@app`-relative test-utils:
 *   - `__setCurrentUser(output)` / `__resetCurrentUser()`  → controls getCurrentUser_IO
 *   - `mockDb(models)` (see mockApiHandler.ts)             → controls DB_CLIENT.use
 * A global `afterEach` resets all holders so tests stay isolated.
 *
 * CANON FOR W0.3 (20 subagents): the module specifiers mocked here are the
 * authoritative list. Handlers reach these modules via these resolved IDs:
 *   - DB:          '@app/db/db.client'                                  (DB_CLIENT)
 *   - auth:        '@domain/user/operations/user-session.operations'    (getCurrentUser_IO)
 *   - permissions: '@app/permissions/permissions.cache'                 (checkPermission)
 *   - runtime:     '@app/runtime/run-after-response'                    (runAfterResponse)
 * The aliases resolve (vitest.config.ts) to the SAME absolute files the handlers
 * import via relative paths, so the mocks intercept correctly.
 */

import { afterEach, vi } from 'vitest';
import type { GetCurrentUserOutput } from '@domain/user/user.types';
import type * as PermissionsCacheModule from '@app/permissions/permissions.cache';

// ─── Shared mutable state (hoisted so vi.mock factories can close over it) ──────

const holders = vi.hoisted(() => {
  /**
   * The undefined-session shape (anonymous request). Must structurally match
   * GetCurrentUserOutput. Duplicated literally here (cannot import inside a hoisted
   * block) — kept trivial and asserted by the type cast in __resetCurrentUser.
   */
  const undefinedOutput = {
    user: undefined,
    currentUser: undefined,
    session: undefined,
  };

  return {
    // Current-user holder: what getCurrentUser_IO resolves to. Defaults to anonymous.
    currentUser: { value: undefinedOutput as unknown },
    // Permission holder: forced result of checkPermission, or null to use the real
    // SSOT config lookup (permissions.config). Most integration tests force `true`
    // so they exercise business logic rather than re-test the permission matrix.
    permission: { value: null as boolean | null },
    // DB holder: the object returned as DB_CLIENT.use. `null` ⇒ any DB access throws
    // a clear "not mocked" error (fail-loud, never a silent undefined).
    db: { value: null as Record<string, unknown> | null },
    undefinedOutput,
  };
});

// ─── Mock: DB client ────────────────────────────────────────────────────────────
//
// DB_CLIENT.use is a Proxy that serves whatever `mockDb(models)` installed. Unmocked
// models/methods throw a descriptive error so a test never silently passes on an
// un-stubbed query. `$transaction(cb)` runs the callback synchronously with the same
// `use` object as the interactive tx client (sufficient for our single-connection
// logical model — handlers call tx.<model>.<method> and tx.$executeRaw exactly like
// the top-level client). `$executeRaw` / `$executeRawUnsafe` default to a no-op
// returning 0 rows so raw counter UPDATEs (incrementGalleryCount) don't blow up.

const makeDbProxy = (): Record<string, unknown> => {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_t, prop: string | symbol) {
      if (typeof prop !== 'string') {
        return undefined;
      }
      const models = holders.db.value;

      // Transaction: invoke callback with the same proxy (acts as `tx`).
      if (prop === '$transaction') {
        return async (arg: unknown) => {
          if (typeof arg === 'function') {
            return (arg as (tx: unknown) => unknown)(dbProxy);
          }
          // Array form: resolve each promise.
          if (Array.isArray(arg)) {
            return Promise.all(arg);
          }
          return undefined;
        };
      }

      // Raw SQL helpers: default no-op (0 rows affected) unless a test overrode them.
      if (
        prop === '$executeRaw' ||
        prop === '$executeRawUnsafe' ||
        prop === '$queryRaw' ||
        prop === '$queryRawUnsafe'
      ) {
        const override = models?.[prop];
        if (typeof override === 'function') {
          return override;
        }
        return async () => 0;
      }

      if (prop === '$disconnect' || prop === '$connect') {
        return async () => undefined;
      }

      if (models && prop in models) {
        return models[prop];
      }

      // Fail loud: an un-stubbed model was accessed by the code under test.
      throw new Error(
        `[test-utils] DB_CLIENT.use.${prop} accessed but not mocked. ` +
          `Add it via mockDb({ ${prop}: { <method>: async () => ... } }).`
      );
    },
  };
  return new Proxy({}, handler);
};

const dbProxy = makeDbProxy();

vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    use: dbProxy,
    // App-logs client: event-log writes go here. Default no-op proxy (writes are
    // fire-and-forget audit and must never fail a handler test).
    useAppLogs: new Proxy(
      {},
      {
        get() {
          return async () => undefined;
        },
      }
    ),
  },
}));

// ─── Mock: current-user resolution (auth chokepoint) ────────────────────────────
//
// Replaces the ENTIRE user-session.operations module so its import-time deps
// (better-auth.config → Stripe/Mailgun/adapters) never load. All exports are
// provided as inert stubs; getCurrentUser_IO is the only one the handler path uses.

vi.mock('@domain/user/operations/user-session.operations', () => ({
  getCurrentUserUndefinedReturnObject: holders.undefinedOutput,
  getCurrentUser_IO: async () => holders.currentUser.value,
  // Inert stubs for the impersonation/dev-login surface (not used by handler tests,
  // present so the module shape stays complete if something imports them).
  deleteSessionByToken_IO: async () => undefined,
  createManualSessionForUser_IO: async () => ({
    success: false,
    error: { type: 'DATABASE_ERROR', operation: 'mock' },
  }),
  getAllSessionsOfUser_IO: async () => ({ sessions: [], nextCursor: null }),
  deleteSession_IO: async () => ({ success: true, data: null }),
  deleteAllSessionsOfUser_IO: async () => ({
    success: true,
    data: { deletedCount: 0 },
  }),
}));

// ─── Mock: permission check ─────────────────────────────────────────────────────
//
// When the holder is a boolean, force that result. When null, fall through to the
// REAL SSOT config check (no DB — system roles resolve in-process). This lets a test
// either (a) bypass authz to focus on business logic, or (b) assert the real matrix.

vi.mock('@app/permissions/permissions.cache', async importOriginal => {
  const actual = await importOriginal<typeof PermissionsCacheModule>();
  return {
    ...actual,
    checkPermission: async <T extends string>(args: {
      roleId: string;
      eventName: T;
    }): Promise<
      | { hasPermission: true; eventName: T; roleId: string }
      | { hasPermission: false; roleId: string }
    > => {
      const forced = holders.permission.value;
      if (forced === null) {
        return actual.checkPermission(args);
      }
      return forced
        ? {
            hasPermission: true,
            eventName: args.eventName,
            roleId: args.roleId,
          }
        : { hasPermission: false, roleId: args.roleId };
    },
  };
});

// ─── Mock: run-after-response (fire-and-forget) ─────────────────────────────────
//
// No-op: prevents cleanup interceptors + audit writes from firing real DB I/O after
// the (mocked) response. Handlers schedule audit logging here; tests don't assert it.

vi.mock('@app/runtime/run-after-response', () => ({
  runAfterResponse: (_task: () => Promise<unknown>): void => {
    // intentionally do nothing — see file header.
  },
  // No-op in tests (nothing is tracked because runAfterResponse above swallows
  // the task); keeps the mock export-complete so importers don't break.
  drainAfterResponseTasks: async (_timeoutMs?: number): Promise<void> => {},
}));

// ─── Per-test configuration API ─────────────────────────────────────────────────

/** Make getCurrentUser_IO resolve to this output (e.g. a logged-in stylist). */
export const __setCurrentUser = (output: GetCurrentUserOutput): void => {
  holders.currentUser.value = output;
};

/** Reset getCurrentUser_IO back to the anonymous (no session) shape. */
export const __resetCurrentUser = (): void => {
  holders.currentUser.value = holders.undefinedOutput as GetCurrentUserOutput;
};

/**
 * Force checkPermission's result for the next assertions.
 *  - `true`  → always granted (focus on business logic)
 *  - `false` → always denied (assert 401/403)
 *  - `null`  → use the REAL SSOT config lookup (default)
 */
export const __setPermission = (value: boolean | null): void => {
  holders.permission.value = value;
};

/**
 * Install the DB stub object served by DB_CLIENT.use. Prefer the `mockDb(...)`
 * helper from mockApiHandler.ts which calls this with a typed shape.
 * @internal
 */
export const __setDb = (models: Record<string, unknown> | null): void => {
  holders.db.value = models;
};

// Reset all per-test state after each test so suites stay isolated.
afterEach(() => {
  holders.currentUser.value = holders.undefinedOutput;
  holders.permission.value = null;
  holders.db.value = null;
  vi.clearAllMocks();
});
