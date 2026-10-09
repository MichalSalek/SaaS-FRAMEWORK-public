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
  // S16 / R2-A mirror: pull refetch from useSession so we can update the
  // reactive atom before nav. authClient.getSession() is an imperative proxy
  // whose /get-session path is NOT in BA 1.6.3 $sessionSignal atomListeners
  // matcher (client/config.mjs) → it does NOT call value.set() → atom stays
  // stale. refetch() (client/query.mjs) DOES call value.set() → useAppRole /
  // useIsStylist see the fresh account_type immediately after onboarding.
  const { refetch: refetchSession } = authClient.useSession();
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
          phone,
          email_marketing: email_marketing ?? false,
          instagram_handle,
          terms_accepted: terms_accepted ?? false,
        });
      }
      return onboardAsClient_IO({
        terms_accepted: variables.terms_accepted ?? false,
      });
    },
    // D1-F7: specific role-aware error feedback — suppress generic toast to
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
      // Semantyczny event funnela (D0 activation): konto-rola utworzone =
      // "rejestracja ukończona" (user Better Auth istnieje wcześniej, ale bez
      // roli nie ma produktu). Jeden punkt dla obu ról. Poprawka danych po
      // Back z CHECKOUT wysyła mutację ponownie (zapis poprawki), więc event
      // pilnuje ref: odpala się raz na instancję lejka.
      // Backend-odpowiednik w EventLog: INFO.USER.STYLIST/CLIENT_ACCOUNT_CREATED.
      // Przez cta-events (nie goły posthog.capture): ten sam event leci teraz
      // także do dataLayer → GTM → GA4 jako `sign_up`, bo konwersje pod Google
      // Ads i Search Console idą tamtą drogą. PostHog dostaje dokładnie to samo.
      if (!signupTrackedRef.current) {
        signupTrackedRef.current = true;
        trackSignupCompleted(variables.role);
      }
      // DECISION (nie usuwaj): po onboardingu BA session ma stary account_type —
      // S16 fix: refetch reactive atom PRZED nav, inaczej useAppRole zwraca stale
      // rolę → zły dashboard. Centralizujemy tu (nie w OnboardingPage), bo oba
      // branche (stylist/client) dzielą tę mutację. Mutation-level onSuccess kończy
      // się PRZED per-call onSuccess w OnboardingPage (TQ v5), więc router.push
      // trafia już na świeżą rolę.
      //
      // Używamy refetchSession() (reactive atom refetch), NIE
      // authClient.getSession(): w better-auth 1.6.3 /get-session NIE jest w
      // matcherze $sessionSignal (client/config.mjs), więc getSession() nie
      // aktualizuje atomu useSession(). refetch() (client/query.mjs) robi
      // value.set() → useAppRole / useIsStylist widzą świeżą rolę natychmiast.
      // refetchSession owinięte w try/catch — nawigacja w callerze NIE może
      // utknąć gdy sieć zawiedzie.
      try {
        await refetchSession();
      } catch {
        // Network down / token issue — TQ invalidate poniżej i tak odświeży
        // account-query; useAppRole dociągnie rolę przy najbliższym refetchu.
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
