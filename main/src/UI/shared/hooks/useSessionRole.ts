// UI/shared/hooks/useSessionRole.ts
// Session-derived role checks for UI gating.
//
// Provides two layers of role-based UI gates:
//
//   1. Primitive booleans — `useIsStylist`, `useIsClient`.
//      Read directly from the Better Auth session (accountType).
//      Use these for one-off conditional rendering where adding a kernel
//      UI_SECTION entry would be overkill.
//
//   2. SSOT-driven gate — `useUiSectionAllowed(section)`. Checks the bound
//      session role against `PERMISSIONS_FOR_ROLE_BY_UI_SECTION` in the
//      shared-kernel (single source of truth). Prefer this for any gate
//      that maps to a recurring UI region (account tabs, pairing QR,
//      shared sessions view, gallery share button, etc.) — adding/removing
//      roles for that region is a kernel-only edit, no UI refactor.
//
// SSR-safe: every hook returns `false` when the session is missing or has
// not hydrated yet. Never throws — callers can use the boolean directly in
// JSX without null-guards.
//
// DECISION (nie usuwaj tego komentarza):
// useUiSectionAllowed uses session.user.role_id (additionalFields), NOT
// accountType. Role drives permissions in the kernel; accountType drives
// view-mode (stylist vs client UX). Admin impersonation correctly bypasses
// the gate because Better Auth swaps role_id during become-user.

import { authClient } from '../../../application/auth/better-auth-client';
import { getSessionRoleId } from '../../../application/auth/session-fields.helpers';
import { PERMISSIONS_POLICY } from '@kernel/policies/permissions.policy';
import {
  UI_SECTION,
  type UiSectionId,
} from '@kernel/domain/permissions/permissions.config';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import { useAuth } from '../../contexts/AuthContext.composition';
import { useCachedCurrentUser } from './useCurrentUserAccount';

// ---------------------------------------------------------------------------
// Primitives — direct session-mode checks
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the active session is in STYLIST mode.
 * Mode reflects `session.user.account_type` (the "I am acting as" toggle),
 * not whether the user owns a stylist account. Use the account-state query
 * if you need ownership semantics.
 */
export function useIsStylist(): boolean {
  const { accountType } = useAuth();
  return accountType === AccountTypeValue.STYLIST;
}

/**
 * Returns `true` when the active session is in CLIENT mode.
 * See `useIsStylist` for mode vs ownership distinction.
 */
export function useIsClient(): boolean {
  const { accountType } = useAuth();
  return accountType === AccountTypeValue.CLIENT;
}

/**
 * `role_id` of the signed-in user: from the Better Auth session, and from the
 * cached account query while the session has not arrived (same `users` row;
 * DECISION in application/auth/session-recovery.ts). Null = not known.
 */
export function useSessionRoleId(): string | null {
  const { isLoggedIn } = useAuth();
  const { data: session } = authClient.useSession();
  const cachedCurrentUser = useCachedCurrentUser();
  return (
    getSessionRoleId(session) ??
    (isLoggedIn ? (cachedCurrentUser?.role_id ?? null) : null)
  );
}

// ---------------------------------------------------------------------------
// SSOT gate — kernel-driven UI_SECTION check
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the active session role is allowed to render the
 * given UI section, as defined in
 * `PERMISSIONS_FOR_ROLE_BY_UI_SECTION` (shared-kernel).
 *
 * Falls back to `false` for missing or hydrating sessions, so the gate
 * is always SSR-safe.
 *
 * @example
 *   const canIssueQr = useUiSectionAllowed(UI_SECTION.PAIRING_ISSUE_QR);
 *   return canIssueQr ? <StylistPairing /> : <ClientPairing />;
 */
export function useUiSectionAllowed(section: UiSectionId): boolean {
  const roleId = useSessionRoleId();
  return PERMISSIONS_POLICY.utils.GET_PERMISSION_APPROVAL_FOR_SECTION({
    roleId: roleId ?? undefined,
    section,
  });
}

// Re-export UI_SECTION so callers can import gate + section ids from one place.
export { UI_SECTION, type UiSectionId };
