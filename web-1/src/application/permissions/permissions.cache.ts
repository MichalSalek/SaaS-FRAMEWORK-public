/**
 * Permissions Cache - SSOT-first permission checks
 *
 * ARCHITECTURE:
 * System roles (NOT_LOGGED_IN, STYLIST, CLIENT, ADMIN) have fixed permissions
 * defined in the kernel (`application/role-permissions.ts`, re-exported by
 * permissions.config.ts). The DB is seeded from the same config
 * (see permissions.seed.ts), so config and DB are always in sync.
 *
 * Strategy: Check config first (O(1) Set lookup) → only query DB for
 * non-system (custom) roles. Eliminates ~99% of DB permission queries.
 *
 * DECISION (nie usuwaj tego komentarza):
 * L3 r28 — This module deliberately does NOT use the generic createCache(ttl, maxSize)
 * helper. Permission sets are immutable, built once at module load from SSOT
 * (kernel role-permissions.ts via permissions.config.ts), and live for the lifetime of the process. There is no
 * TTL to expire and no LRU eviction to bound — the data structure is a fixed
 * Map<RoleId, ReadonlySet<EventName>>. Custom (non-system) roles fall through to
 * a direct DB query without an in-process cache, because permission mutations
 * for custom roles must be reflected immediately (no cache invalidation surface).
 * If future custom-role volume warrants caching, introduce createCache<bool>(TTL, N)
 * keyed by `${roleId}:${eventName}` HERE; do NOT cache the whole rolePermission row.
 */

import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import {
  BASE_PERMISSIONS,
  LOGGED_USER_PERMISSIONS,
  STYLIST_SPECIFIC_PERMISSIONS,
  CLIENT_SPECIFIC_PERMISSIONS,
  SELF_ONLY_EVENTS,
} from './permissions.config';

// ─── SSOT Permission Sets (built once at module load) ───────────────────────

const SELF_ONLY_SET: ReadonlySet<string> = new Set(SELF_ONLY_EVENTS);

const PERMISSION_SETS_BY_ROLE: ReadonlyMap<
  string,
  ReadonlySet<string>
> = new Map([
  [SystemRoleId.NOT_LOGGED_IN, new Set<string>(BASE_PERMISSIONS)],
  [
    SystemRoleId.STYLIST_ROLE,
    new Set<string>([
      ...LOGGED_USER_PERMISSIONS,
      ...STYLIST_SPECIFIC_PERMISSIONS,
    ]),
  ],
  [
    SystemRoleId.CLIENT_ROLE,
    new Set<string>([
      ...LOGGED_USER_PERMISSIONS,
      ...CLIENT_SPECIFIC_PERMISSIONS,
    ]),
  ],
  // MASTER_ADMIN handled separately: has ALL permissions except SELF_ONLY
]);

/**
 * Check permission from SSOT config (O(1), no DB query)
 * @returns boolean if system role, null if non-system (needs DB fallback)
 */
const checkPermissionFromConfig = (
  roleId: string,
  eventName: string
): boolean | null => {
  if (roleId === SystemRoleId.MASTER_ADMIN) {
    return !SELF_ONLY_SET.has(eventName);
  }

  const permissionSet = PERMISSION_SETS_BY_ROLE.get(roleId);
  if (permissionSet) {
    return permissionSet.has(eventName);
  }

  return null; // non-system role → DB fallback
};

/**
 * Check if user has permission for event
 * System roles: O(1) config lookup. Custom roles: DB query fallback.
 * @internal Used internally by checkPermission()
 */
const hasPermission = async ({
  roleId,
  eventName,
}: {
  roleId: string;
  eventName: string;
}): Promise<boolean> => {
  const configResult = checkPermissionFromConfig(roleId, eventName);
  if (configResult !== null) {
    return configResult;
  }

  // Non-system role: query DB (future-proof for custom roles).
  //
  // DECISION (nie usuwaj tego komentarza):
  // FAIL CLOSED on a DB error. This is the only authorization read in this module
  // that touches the DB (custom/non-system roles only — none exist today, so this
  // branch is latent/future-proof). A Prisma rejection here (Neon cold-start,
  // dropped connection) MUST resolve to "no permission" — never propagate as an
  // unhandled rejection that the auth middleware might mishandle into something other
  // than a denial. Denying on read failure is the safe default for an authz check; the
  // error is reported for observability and the user retries.
  try {
    const rolePermission = await DB_CLIENT.use.rolePermission.findFirst({
      where: {
        role_id: roleId,
        permission: {
          event_name: eventName,
        },
      },
    });

    return rolePermission !== null;
  } catch (error) {
    reportIssueBackend({
      namespace: 'PERMISSIONS_CACHE',
      message: `hasPermission DB read failed for role_id=${roleId} event=${eventName} — failing closed`,
      payload:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : { error: String(error) },
      mode: 'error',
    });
    return false;
  }
};

/**
 * Type-safe permission check with type guard
 * Returns discriminated union for compile-time type safety
 *
 * @example
 * const result = await checkPermission({ roleId, eventName: 'CREATE_GALLERY_RECORD' });
 * if (result.hasPermission) {
 *   // TypeScript knows result.eventName exists and is the correct type
 *   result.eventName // → 'CREATE_GALLERY_RECORD'
 * }
 */
export const checkPermission = async <T extends string>({
  roleId,
  eventName,
}: {
  roleId: string;
  eventName: T;
}): Promise<
  | { hasPermission: true; eventName: T; roleId: string }
  | { hasPermission: false; roleId: string }
> => {
  const hasAccess = await hasPermission({ roleId, eventName });

  return hasAccess
    ? { hasPermission: true, eventName, roleId }
    : { hasPermission: false, roleId };
};
