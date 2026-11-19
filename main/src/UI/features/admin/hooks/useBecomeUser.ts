// UI/features/admin/hooks/useBecomeUser.ts
// TQ v5 mutation — POST /api/v1/admin/become-user
//
// Wraps `becomeUser_IO`, which orchestrates the full identity switch: cancels in-flight requests,
// calls the backend (Better Auth swaps the session token; the become-user header goes via
// http.interceptor.headers, the body returns SafeCurrentUser), remembers the admin screen it
// started from (path + query with filters), and reloads the whole document into
// REDIRECTIONS_ON_EVENTS[USER_BECAME_SOMEONE_ELSE] (/app). No cache reset here: the reload drops
// every in-memory cache (DECISION in application/auth/identity-switch.ts).
//
// DECISION: the two tokens flow out-of-band only (Authorization + become-user headers), never in
// the body. The body is SafeCurrentUser, stripped by toSafeCurrentUser() in
// web-1/src/domain/user/user.utils.api.ts; the http.interceptor persists the new session token and
// the opaque become-user backup token (<ref_id>.<expires_ms>.<hmac>, bound server-side) to
// localStorage. This hook never reads, logs or inspects tokens.

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
