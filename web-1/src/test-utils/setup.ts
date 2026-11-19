import { afterEach, vi } from 'vitest';
import {
  configureLockOrderAssertions,
  resetLockOrderTracking,
} from '@app/db/lock-order';
import type {
  CurrentUserResolution,
  GetCurrentUserOutput,
} from '@domain/user/user.types';
import type { AuthUnavailableStage } from '@kernel/application/common-errors.types';
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
    // Current-user holder: the CurrentUserResolution getCurrentUser_IO resolves to.
    // Defaults to anonymous.
    currentUser: {
      value: { status: 'ANONYMOUS', output: undefinedOutput } as unknown,
    },
    // Permission holder: forced result of checkPermission, or null to use the real
    // SSOT config lookup (permissions.config). Most integration tests force `true`
    // so they exercise business logic rather than re-test the permission matrix.
    // 'UNAVAILABLE' forces a failed custom-role permission read.
    permission: { value: null as boolean | 'UNAVAILABLE' | null },
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
    }): Promise<PermissionsCacheModule.PermissionCheckResult<T>> => {
      const forced = holders.permission.value;
      if (forced === null) {
        return actual.checkPermission(args);
      }
      if (forced === 'UNAVAILABLE') {
        return {
          hasPermission: false,
          roleId: args.roleId,
          reason: 'UNAVAILABLE',
        };
      }
      return forced
        ? {
            hasPermission: true,
            eventName: args.eventName,
            roleId: args.roleId,
          }
        : { hasPermission: false, roleId: args.roleId, reason: 'DENIED' };
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
  const { user, currentUser, session } = output;
  const resolution: CurrentUserResolution =
    user !== undefined && currentUser !== undefined && session !== undefined
      ? { status: 'AUTHENTICATED', output: { user, currentUser, session } }
      : {
          status: 'ANONYMOUS',
          output: {
            user: undefined,
            currentUser: undefined,
            session: undefined,
          },
        };
  holders.currentUser.value = resolution;
};

/** Make getCurrentUser_IO report an infrastructure failure at this stage. */
export const __setAuthUnavailable = (stage: AuthUnavailableStage): void => {
  const resolution: CurrentUserResolution = { status: 'UNAVAILABLE', stage };
  holders.currentUser.value = resolution;
};

/** Reset getCurrentUser_IO back to the anonymous (no session) shape. */
export const __resetCurrentUser = (): void => {
  holders.currentUser.value = {
    status: 'ANONYMOUS',
    output: holders.undefinedOutput,
  };
};

/**
 * Force checkPermission's result for the next assertions.
 *  - `true`  → always granted (focus on business logic)
 *  - `false` → always denied (assert 401/403)
 *  - `'UNAVAILABLE'` → the custom-role permission read failed (assert 503)
 *  - `null`  → use the REAL SSOT config lookup (default)
 */
export const __setPermission = (
  value: boolean | 'UNAVAILABLE' | null
): void => {
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
// Every unit test runs with the lock-order checker on (application/db/lock-order.ts): an operation that
// takes row locks out of order through lock-rows throws LockOrderViolationError in its test.
configureLockOrderAssertions(true);

afterEach(() => {
  resetLockOrderTracking();
  holders.currentUser.value = {
    status: 'ANONYMOUS',
    output: holders.undefinedOutput,
  };
  holders.permission.value = null;
  holders.db.value = null;
  vi.clearAllMocks();
});
