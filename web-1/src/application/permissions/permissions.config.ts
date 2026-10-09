/**
 * Permissions Configuration - role metadata + self-only events
 *
 * SSOT for role permission ARRAYS lives in kernel:
 * `.shared-kernel/application/role-permissions.ts` (re-exported below).
 *
 * This file owns backend-only concerns:
 * - SYSTEM_ROLES_META: role metadata (name, description)
 * - SELF_ONLY_EVENTS: events restricted to "self" account (extra guard)
 */

import {
  SystemRoleId,
  RoleValue,
  type SystemRoleIdType,
} from '@kernel/models/db_models.manual.dto';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

// SSOT lift (C2 fix): permission arrays moved to kernel.
// `tests/smoke/_rbac-matrix.ts` and `tests/audit/permissions.sh` read kernel directly.
export {
  BASE_PERMISSIONS,
  LOGGED_USER_PERMISSIONS,
  STYLIST_SPECIFIC_PERMISSIONS,
  CLIENT_SPECIFIC_PERMISSIONS,
} from '@kernel/application/role-permissions';

// System roles metadata (IDs from SSOT SystemRoleId)
export const SYSTEM_ROLES_META: Record<
  SystemRoleIdType,
  { name: string; description: string }
> = {
  [SystemRoleId.NOT_LOGGED_IN]: {
    name: RoleValue.NOT_LOGGED_IN,
    description: 'Guest user (not authenticated)',
  },
  [SystemRoleId.STYLIST_ROLE]: {
    name: RoleValue.STYLIST_ROLE,
    description: 'Stylist account holder',
  },
  [SystemRoleId.CLIENT_ROLE]: {
    name: RoleValue.CLIENT_ROLE,
    description: 'Client user',
  },
  [SystemRoleId.MASTER_ADMIN]: {
    name: RoleValue.MASTER_ADMIN,
    description: 'Full system access',
  },
};

export const SELF_ONLY_EVENTS = [
  APP_EVENTS.COMMANDS.USER.USER_DISABLE_SELF,
  APP_EVENTS.COMMANDS.USER.USER_REQUEST_DELETE,
  // ADRR Model A: reactivate + GDPR-erase act strictly on currentUser.id (own
  // account). No "act on other user" variant exists — keep out of admin wildcard.
  APP_EVENTS.COMMANDS.USER.USER_REACTIVATE_ACCOUNT,
  APP_EVENTS.COMMANDS.USER.USER_GDPR_ERASE,
] as const;
