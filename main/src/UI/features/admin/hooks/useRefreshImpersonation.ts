// UI/features/admin/hooks/useRefreshImpersonation.ts
// TQ v5 mutation — POST /api/v1/admin/refresh-impersonation
//
// Extends the impersonation backup token TTL (default 2h, see IMPERSONATION_TIMEOUT_MS in
// shared-kernel/domain/admin/admin.config.ts). Used by ImpersonationBanner when the admin chooses to
// keep the session alive past the original expiry.
// RESPONSE: { expiresAt: number } — new expiry timestamp (ms epoch). No session token is exposed;
// the http.interceptor persists the refreshed opaque header on the same code path that handles
// BECOME_USER headers.
//
// DECISION: the body is empty. The admin identity is recovered server-side from the opaque
// become-user token (HMAC + DB lookup); the caller MUST be the impersonated target, not the admin.
// Refresh is a no-op once the token has expired: the operation returns VALIDATION_ERROR, which the
// http.interceptor surfaces as a generic warning snackbar.

import { useMutation } from '@tanstack/react-query';
import { refreshBecomeUser_IO } from '../../../../domain/admin/users/adminUsersIO.possibilities.api';

const refreshImpersonation = refreshBecomeUser_IO;

export function useRefreshImpersonation() {
  return useMutation({
    mutationFn: () => refreshImpersonation({}),
    meta: { suppressGlobalError: true },
  });
}
