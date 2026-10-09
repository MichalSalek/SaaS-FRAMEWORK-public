// UI/features/account/hooks/useDisableUserSelf.ts
// TQ v5 mutation — POST /api/v1/user/disable/self
// On success: redirect to REDIRECTIONS_ON_EVENTS.USER_DISABLED_SELF (HOME).
// On 409 CANNOT_DISABLE_ACTIVE_SUBSCRIPTION: caller shows toast with Billing link.
// Stack: TanStack Query v5 + unified io.ts front-door (promise-first).

import { useMutation } from '@tanstack/react-query';
import { disableUserSelf_IO } from '../../../../domain/user/userIO.possibilities.api';
import { redirectToByEvent } from '../../../../application/routing/redirections';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

export function useDisableUserSelf() {
  return useMutation({
    mutationFn: () => disableUserSelf_IO({}),
    // Caller owns the error toast so global fallback is suppressed to avoid duplicates.
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      // FDX FAZA 2: redirect moved out of the IO layer into this hook.
      // Backend responds with USER_DISABLED_SELF → REDIRECTIONS_ON_EVENTS maps it
      // to HOME, so this navigation actually fires (1:1 with the old IO callback).
      void redirectToByEvent({
        event: APP_EVENTS.INFO.USER.USER_DISABLED_SELF,
      });
    },
  });
}
