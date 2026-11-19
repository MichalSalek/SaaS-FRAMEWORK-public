/**
 * Permissions Cache: SSOT-first permission checks.
 *
 * System roles (NOT_LOGGED_IN, STYLIST, CLIENT, ADMIN) have fixed permissions in the kernel
 * (`application/role-permissions.ts`, re-exported by permissions.config.ts); the DB is seeded
 * from the same config (permissions.seed.ts). Check config first (O(1) Set lookup), query the
 * DB only for custom roles.
 *
 * DECISION: this module deliberately does NOT use the generic createCache(ttl, maxSize). System
 * role permission sets are immutable, built once at module load from the kernel SSOT, and live
 * for the process (no TTL, no eviction). Custom (non-system) roles query the DB directly with no
 * in-process cache, so permission mutations for them apply immediately (no invalidation
 * surface). If custom-role volume ever warrants caching, add createCache<bool>(TTL, N) keyed by
 * `${roleId}:${eventName}` HERE; do NOT cache the whole rolePermission row.
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

type PermissionLookup = 'GRANTED' | 'DENIED' | 'UNAVAILABLE';

/**
 * Check if user has permission for event
 * System roles: O(1) config lookup. Custom roles: DB query fallback.
 * @internal Used internally by checkPermission()
 */
const lookUpPermission = async ({
  roleId,
  eventName,
}: {
  roleId: string;
  eventName: string;
}): Promise<PermissionLookup> => {
  const configResult = checkPermissionFromConfig(roleId, eventName);
  if (configResult !== null) {
    return configResult ? 'GRANTED' : 'DENIED';
  }

  // Non-system role: query DB (future-proof for custom roles).
  //
  // DECISION: FAIL CLOSED on a DB error, but say so. This is the only authorization read here that
  // touches the DB (custom roles only). A Prisma rejection (Neon cold start, dropped connection,
  // missing table) MUST never grant access, and it is NOT a real refusal either: answering it as
  // DENIED gave a legitimate custom-role user 403 UNAUTHORIZED for an outage. It resolves to
  // UNAVAILABLE, which the middleware maps to 503 AUTH_UNAVAILABLE + Retry-After. System roles never
  // reach this read.
  try {
    const rolePermission = await DB_CLIENT.use.rolePermission.findFirst({
      where: {
        role_id: roleId,
        permission: {
          event_name: eventName,
        },
      },
    });

    return rolePermission !== null ? 'GRANTED' : 'DENIED';
  } catch (error) {
    reportIssueBackend({
      namespace: 'PERMISSIONS_CACHE',
      message: `hasPermission DB read failed for role_id=${roleId} event=${eventName}; answering AUTH_UNAVAILABLE`,
      payload:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : { error: String(error) },
      mode: 'error',
    });
    return 'UNAVAILABLE';
  }
};

export type PermissionCheckResult<T extends string> =
  | { hasPermission: true; eventName: T; roleId: string }
  | {
      hasPermission: false;
      roleId: string;
      /** DENIED = a real refusal (401/403); UNAVAILABLE = the permission read failed (503). */
      reason: 'DENIED' | 'UNAVAILABLE';
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
}): Promise<PermissionCheckResult<T>> => {
  const lookup = await lookUpPermission({ roleId, eventName });

  return lookup === 'GRANTED'
    ? { hasPermission: true, eventName, roleId }
    : { hasPermission: false, roleId, reason: lookup };
};
