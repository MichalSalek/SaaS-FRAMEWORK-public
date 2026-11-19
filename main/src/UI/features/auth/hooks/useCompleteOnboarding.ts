// UI/features/auth/hooks/useCompleteOnboarding.ts
// TQ v5 mutation — POST /api/v1/user/onboard-stylist | /api/v1/user/onboard-client
// On success: invalidate ['account', 'current'] so AuthContext re-fetches.

import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { trackSignupCompleted } from '../../../../application/analytics/cta-events';
import {
  onboardAsClient_IO,
  onboardAsStylist_IO,
} from '../../../../domain/user/userOnboardingIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { isIOError } from '../../../../application/http/io';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { authClient } from '../../../../application/auth/better-auth-client';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';

/* ─── Variables type — discriminated union by role ─── */

export type CompleteOnboardingVariables =
  | ({
      role: 'stylist';
    } & USER_DTO_API_V1['USER_ONBOARD_AS_STYLIST']['REQUEST'])
  | ({ role: 'client' } & USER_DTO_API_V1['USER_ONBOARD_AS_CLIENT']['REQUEST']);

type CompleteOnboardingResponse =
  | USER_DTO_API_V1['USER_ONBOARD_AS_STYLIST']['RESPONSE']
  | USER_DTO_API_V1['USER_ONBOARD_AS_CLIENT']['RESPONSE'];

/**
 * Submits the onboarding form. Calls the role-specific endpoint and
 * invalidates the current-user cache so dependent UI re-fetches.
 */
export function useCompleteOnboarding() {
  const queryClient = useQueryClient();
  // Pull refetch from useSession so we can update the reactive atom before nav.
  // authClient.getSession() is an imperative proxy whose /get-session path is NOT in the BA 1.6.3
  // $sessionSignal atomListeners matcher (client/config.mjs) → it does NOT call value.set() → the atom
  // stays stale. refetch() (client/query.mjs) DOES call value.set() → useAppRole / useIsStylist see
  // the fresh account_type immediately after onboarding.
  const { data: session, refetch: refetchSession } = authClient.useSession();
  const signupTrackedRef = useRef(false);

  return useMutation<
    CompleteOnboardingResponse,
    Error,
    CompleteOnboardingVariables
  >({
    mutationFn: variables => {
      if (variables.role === 'stylist') {
        const {
          display_name,
          address_city,
          phone,
          email_marketing,
          instagram_handle,
          terms_accepted,
        } = variables;
        return onboardAsStylist_IO({
          display_name,
          address_city,
          ...(phone !== undefined && { phone }),
          email_marketing: email_marketing ?? false,
          ...(instagram_handle !== undefined && { instagram_handle }),
          terms_accepted: terms_accepted ?? false,
        });
      }
      return onboardAsClient_IO({
        terms_accepted: variables.terms_accepted ?? false,
      });
    },
    // Specific role-aware error feedback — suppress generic toast to
    // avoid double snackbar alongside OnboardingPage's own inline error state.
    meta: { suppressGlobalError: true },
    onError: (error, variables) => {
      // One toast per failure (toast model in queryClient.config): an HTTP
      // error response already toasted its specific backend event through the
      // interceptor, so the role-aware fallback is only for a failure that never
      // reached it. Before, a rejected onboard showed three toasts (backend
      // event, this one and the page's own).
      if (isIOError(error)) {
        return;
      }
      const eventKey =
        variables.role === 'stylist'
          ? APP_EVENTS.INFO.USER.CANNOT_ONBOARD_AS_STYLIST
          : APP_EVENTS.INFO.USER.CANNOT_ONBOARD_AS_CLIENT;
      pushNewSnackbar(eventKey, 'error');
    },
    onSuccess: async (_data, variables) => {
      // Semantic funnel event (activation): account-role created = "sign-up completed" (the Better Auth
      // user exists earlier, but without a role there is no product). One point for both roles. A data
      // correction after Back from CHECKOUT sends the mutation again (saving the correction), so the
      // event is guarded by a ref: it fires once per funnel instance.
      // Backend counterpart in EventLog: INFO.USER.STYLIST/CLIENT_ACCOUNT_CREATED.
      // Through cta-events (not a bare posthog.capture): the same event also goes to dataLayer → GTM →
      // GA4 as `sign_up`, because Google Ads and Search Console conversions go that way. PostHog gets
      // exactly the same.
      const userId = session?.user?.id;
      if (!signupTrackedRef.current && userId) {
        signupTrackedRef.current = true;
        trackSignupCompleted(variables.role, userId);
      }
      // DECISION: after onboarding the Better Auth session still holds the old account_type, so
      // refetch the reactive session atom BEFORE navigating, otherwise useAppRole returns the stale
      // role and the wrong dashboard shows. It lives here (not in OnboardingPage) because both
      // branches share this mutation; the mutation-level onSuccess finishes before the per-call
      // onSuccess (TQ v5), so router.push lands on the fresh role. Use refetchSession(), NOT
      // authClient.getSession() (reason in useLoginFlows.ts). The call is wrapped in try/catch so
      // navigation in the caller cannot get stuck on a network failure.
      try {
        await refetchSession();
      } catch {
        // Network down / token issue — the TQ invalidate below refreshes the account query anyway;
        // useAppRole picks up the role at the next refetch.
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.current,
      });
      // Parity with useSwitchRole: onboarding creates/activates a role, so the
      // account-state guard view must re-derive alongside the account itself.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.state,
      });
    },
  });
}
