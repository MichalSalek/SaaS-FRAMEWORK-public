import type { SafeCurrentUser } from '@kernel/models/session/session.dto';
import { queryClient } from '../http/queryClient.config';
import { queryKeys } from '../http/queryKeys.factory';

// DECISION (nie usuwaj tego komentarza):
// Client store ZAWSZE trzyma SafeCurrentUser (bez session.token + session.userId).
// Backend NIGDY nie zwraca surowej CurrentUser do klienta — token persists
// out-of-band w Authorization header + DB. SSOT: `SafeCurrentUser` w
// `.shared-kernel/models/session/session.dto.ts`. Każdy endpoint zwracający
// CurrentUser przepuszcza go przez `toSafeCurrentUser()` w
// `web-1/src/domain/user/user.utils.api.ts`.

export const resetUserSlice = (): void => {
  queryClient.setQueryData(queryKeys.account.current, undefined);
  void queryClient.invalidateQueries({ queryKey: queryKeys.account.current });
};

export const setCurrentUser = (user: SafeCurrentUser | undefined): void => {
  queryClient.setQueryData(queryKeys.account.current, user);
};
