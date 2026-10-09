// UI/features/admin/hooks/useBecomeUser.ts
// TQ v5 mutation — POST /api/v1/admin/become-user
//
// Wraps `becomeUser_IO` which already orchestrates the full identity switch:
// - cancels in-flight requests (identity changing)
// - calls backend (Better Auth swaps session token + sets become-user header
//   via http.interceptor.headers — token persisted out-of-band, body returns SafeCurrentUser)
// - remembers the admin screen it started from (path + query with filters)
// - reloads the whole document into REDIRECTIONS_ON_EVENTS[USER_BECAME_SOMEONE_ELSE]
//   (/app) — no cache reset here: the reload drops every in-memory cache
//   (DECISION in application/auth/identity-switch.ts)
//
// DECISION (nie usuwaj tego komentarza):
// Two tokens flow out-of-band only (Authorization + become-user headers), NEVER
// in body. Response body = SafeCurrentUser (Omit<CurrentUser, 'session'> & {
// session: SafeSession }) — strip-down enforced by `toSafeCurrentUser()` in
// `web-1/src/domain/user/user.utils.api.ts`. The http.interceptor persists the
// new session token (Authorization) + opaque become-user backup token (header)
// to localStorage. We never read/log/inspect tokens here.
// Backup token shape: opaque <ref_id>.<expires_ms>.<hmac> bound server-side.

import { useMutation } from '@tanstack/react-query';
import { becomeUser_IO } from '../../../../domain/admin/users/adminUsersIO.possibilities.api';
import { toPromise } from '../../../../application/http/toPromise.adapter';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

type BecomeUserRequest = ADMIN_DTO_API_V1['BECOME_USER']['REQUEST'];

const becomeUser = toPromise(becomeUser_IO);

export function useBecomeUser() {
  return useMutation({
    mutationFn: (req: BecomeUserRequest) => becomeUser(req),
    // UserDetailsDialog (the only caller) owns the user-facing toast via a
    // per-call onError; success ends in a full reload — suppress the generic
    // global error.
    meta: { suppressGlobalError: true },
  });
}
