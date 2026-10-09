export type AdminInsufficientPermissionsError = {
  type: 'ADMIN_INSUFFICIENT_PERMISSIONS';
  requiredRole: string;
  currentRole: string;
};

// Self / cross-admin guard: admin attempting to act on themselves or another admin.
// Distinct from ADMIN_INSUFFICIENT_PERMISSIONS — caller HAS the permission, but the
// target is protected. Surfaces a specific 403 reason so the UI can explain why.
export type AdminTargetProtectedError = {
  type: 'ADMIN_TARGET_PROTECTED';
  reason: 'ADMIN_CANNOT_TARGET_SELF' | 'ADMIN_CANNOT_TARGET_ADMIN';
};

export type AdminTargetNotFoundError = {
  type: 'ADMIN_TARGET_NOT_FOUND';
  targetId: string;
  targetType: 'USER' | 'ACCOUNT' | 'RECORD';
};

export type AdminResourceHasReferencesError = {
  type: 'ADMIN_RESOURCE_HAS_REFERENCES';
  resourceId: string;
  resourceType: 'COLOR' | 'TRAIT';
  referenceCount: number;
};

// Unique constraint (P2002) on an admin-managed resource name (color / trait).
// Distinct from ADMIN_RESOURCE_HAS_REFERENCES (delete-time FK guard) — this is a
// create/update-time name collision. Maps to 409 Conflict so the UI can prompt for
// a different name instead of surfacing a generic 500.
export type AdminDuplicateResourceNameError = {
  type: 'ADMIN_DUPLICATE_RESOURCE_NAME';
  resourceType: 'COLOR' | 'TRAIT';
  name: string;
};

// System role is config-defined and not editable from the DB (e.g. MASTER_ADMIN
// has a wildcard permission set resolved in permissions.cache.ts, bypassing DB rows).
// Attempting to edit its permission matrix is rejected: the write would be a no-op
// at runtime AND would write misleading audit diffs. Surfaces a 403 the UI explains.
export type AdminSystemRoleImmutableError = {
  type: 'ADMIN_SYSTEM_ROLE_IMMUTABLE';
  roleId: string;
};

// Attempt to delete the main (is_main=true) policy. The main policy is the
// currently-active legal document (ToS / privacy) shown to users. Deleting it
// would leave a zero-main-policy state with no active legal doc, so the admin must
// first promote another policy to main (setMainPolicy) before deleting this one.
// Distinct from ADMIN_TARGET_PROTECTED (self/cross-admin guard) — this is a
// resource-state guard, not an actor-relationship guard. Maps to 400 Bad Request.
export type AdminPolicyIsMainCannotDeleteError = {
  type: 'ADMIN_POLICY_IS_MAIN_CANNOT_DELETE';
  policyId: string;
};

export type UrlAccessForbiddenError = {
  type: 'CHECK_ACCESS_URL_FORBIDDEN';
};

export type UrlAccessNetworkError = {
  type: 'CHECK_ACCESS_URL_NETWORK';
  reason: 'TIMEOUT' | 'FETCH_FAILED';
};

// PLQS Wave 4D — sensitive mutation attempted while admin impersonating user.
// Hybrid gate: BLOCK by default + allow explicit override via query param.
// Both paths emit audit events (BLOCKED vs OVERRIDE) — see admin-impersonation.utils.ts.
export type ImpersonationSensitiveBlockedError = {
  type: 'IMPERSONATION_SENSITIVE_BLOCKED';
  command: string;
  adminUserId: string;
  targetUserId: string;
};

export type AdminError =
  | AdminInsufficientPermissionsError
  | AdminTargetProtectedError
  | AdminTargetNotFoundError
  | AdminResourceHasReferencesError
  | AdminSystemRoleImmutableError
  | AdminPolicyIsMainCannotDeleteError
  | UrlAccessForbiddenError
  | UrlAccessNetworkError
  | ImpersonationSensitiveBlockedError
  | AdminDuplicateResourceNameError;
