// UI/features/account/hooks/useDisableUserSelf.ts
// TQ v5 mutation — POST /api/v1/user/disable/self
// On success: redirect to REDIRECTIONS_ON_EVENTS.USER_DISABLED_SELF (HOME).
// On 409 CANNOT_DISABLE_ACTIVE_SUBSCRIPTION: caller shows toast with Billing link.
// Stack: TanStack Query v5 + unified io.ts front-door (promise-first).

import { useMutation } from '@tanstack/react-query';
import { disableUserSelf_IO } from '../../../../domain/user/userIO.possibilities.api';
import { redirectToByEvent } from '../../../../application/routing/redirections';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { trackFlowStep } from '../../../../application/analytics/flow-events';
import { flowErrorCode } from '../../shared/analytics/flowErrorCode';

export function useDisableUserSelf() {
  return useMutation({
    mutationFn: () => disableUserSelf_IO({}),
    // Caller owns the error toast so global fallback is suppressed to avoid duplicates.
    meta: { suppressGlobalError: true },
    onError: error => {
      trackFlowStep('account', 'failed', {
        action: 'disable',
        code: flowErrorCode(error),
      });
    },
    onSuccess: () => {
      trackFlowStep('account', 'disabled');
      // Redirect lives in this hook, not in the IO layer.
      // Backend responds with USER_DISABLED_SELF → REDIRECTIONS_ON_EVENTS maps it
      // to HOME, so this navigation actually fires.
      void redirectToByEvent({
        event: APP_EVENTS.INFO.USER.USER_DISABLED_SELF,
      });
    },
  });
}
