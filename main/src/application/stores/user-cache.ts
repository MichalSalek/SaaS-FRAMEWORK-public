import type { SafeCurrentUser } from '@kernel/models/session/session.dto';
import { queryClient } from '../http/queryClient.config';
import { queryKeys } from '../http/queryKeys.factory';

// DECISION: the client store ALWAYS holds SafeCurrentUser (no session.token, no session.userId).
// The backend NEVER returns the raw CurrentUser to the client; the token persists out-of-band in
// the Authorization header + DB. SSOT: `SafeCurrentUser` in
// `.shared-kernel/models/session/session.dto.ts`; every endpoint returning CurrentUser passes it
// through `toSafeCurrentUser()` in `web-1/src/domain/user/user.utils.api.ts`.

export const resetUserSlice = (): void => {
  queryClient.setQueryData(queryKeys.account.current, undefined);
  void queryClient.invalidateQueries({ queryKey: queryKeys.account.current });
};

export const setCurrentUser = (user: SafeCurrentUser | undefined): void => {
  queryClient.setQueryData(queryKeys.account.current, user);
};
