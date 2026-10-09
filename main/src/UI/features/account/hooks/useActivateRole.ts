// UI/features/account/hooks/useActivateRole.ts
// TQ v5 mutation — POST onboard-client (client role).
// For stylist activation the page navigates to /app/onboarding (full form required).
// Stack: TanStack Query v5.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { onboardAsClient_IO } from '../../../../domain/user/userOnboardingIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { authClient } from '../../../../application/auth/better-auth-client';

/* ─── Hook ─── */

/**
 * Mutation for the activate-client flow only.
 * Activate-stylist is a full onboarding form — handled by useOnboarding / OnboardingPage.
 */
export function useActivateClientRole() {
  const queryClient = useQueryClient();
  // Mirror useCompleteOnboarding: pull refetch from useSession so we update the
  // reactive atom. After activation BA session still carries the OLD account_type
  // (cookieCache off, but the reactive atom is not auto-refetched). Without this
  // useAppRole keeps the stale role → the user sees the wrong dashboard ("cichy
  // bounce"). refetchSession() (client/query.mjs) calls value.set() on the
  // $sessionSignal atom; authClient.getSession() does NOT (its /get-session path
  // is not in the BA 1.6.3 atomListeners matcher), so refetch is mandatory here.
  const { refetch: refetchSession } = authClient.useSession();

  return useMutation({
    mutationFn: () => onboardAsClient_IO({}),
    meta: { suppressGlobalError: true },
    onSuccess: async () => {
      // refetchSession owinięte w try/catch — invalidate poniżej i tak odświeży
      // account-query; useAppRole dociągnie świeżą rolę przy najbliższym refetchu.
      try {
        await refetchSession();
      } catch {
        // Network down / token issue — cache invalidation below still refreshes.
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.current,
      });
    },
  });
}
