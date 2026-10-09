// UI/features/admin/hooks/useSwitchBackBecomeUser.ts
// TQ v5 mutation — POST /api/v1/admin/switch-back-become-user
//
// Wraps `switchBackUser_IO` which orchestrates the reverse switch:
// - cancels in-flight requests
// - calls backend (Better Auth restores the original admin session token
//   from the server-side ImpersonationBackup table, identified via the
//   opaque become-user header)
// - reloads the whole document into the admin screen remembered at become-user
//   time (same path + query, so list filters survive); fallback
//   REDIRECTIONS_ON_EVENTS[USER_SWITCHED_BACK_TO_SELF] (DECISION in
//   application/auth/identity-switch.ts)
//
// DECISION (nie usuwaj tego komentarza):
// REQUEST = undefined — admin identity is recovered server-side from the
// opaque token (HMAC + DB lookup against ImpersonationBackup), never trusted
// from the client. Caller MUST be the impersonated target (not the admin),
// validated in the operation.

import { useMutation } from '@tanstack/react-query';
import { switchBackUser_IO } from '../../../../domain/admin/users/adminUsersIO.possibilities.api';
import { toPromise } from '../../../../application/http/toPromise.adapter';

const switchBack = toPromise(switchBackUser_IO);

export function useSwitchBackBecomeUser() {
  return useMutation({
    mutationFn: () => switchBack(undefined),
    meta: { suppressGlobalError: true },
  });
}
