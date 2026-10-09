// UI/features/shared/hooks/useSwitchRole.ts
// TQ v5 mutation — POST /api/v1/user/switch-role (switch active account_type).
// Shared: consumed by dashboard RoleSwitcher AND the account-pay role-switch
// affordance (dual-role user in client mode). Backend switches the role in the
// SAME session; front refetches the BA session so useAppRole / useIsClient
// re-derive the active role. Zero navigation.
// Stack: TanStack Query v5.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AccountType } from '@kernel/models/db_models.generated.dto';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import { switchRole_IO } from '../../../../domain/user/userOnboardingIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { authClient } from '../../../../application/auth/better-auth-client';

type SwitchRoleResponse = USER_DTO_API_V1['USER_SWITCH_ROLE']['RESPONSE'];
type SwitchRoleVariables = { account_type: AccountType };

/**
 * Mutation switching the user's active role (account_type).
 *
 * onSuccess mirrors useCompleteOnboarding: refetch the reactive BA session atom
 * (refetchSession from useSession, NOT authClient.getSession — /get-session is
 * not in BA 1.6.3 $sessionSignal matcher so getSession does not value.set() the
 * atom) so useAppRole sees the fresh account_type immediately and DashboardPage
 * re-renders the correct variant. Then invalidate the account caches.
 *
 * Errors surface via the caller (RoleSwitcher) — suppressGlobalError avoids a
 * generic toast so the component can show a role-specific message.
 */
export function useSwitchRole() {
  const queryClient = useQueryClient();
  const { refetch: refetchSession } = authClient.useSession();

  return useMutation<SwitchRoleResponse, Error, SwitchRoleVariables>({
    mutationFn: ({ account_type }) => switchRole_IO({ account_type }),
    meta: { suppressGlobalError: true },
    onSuccess: async () => {
      // refetchSession owinięte w try/catch — invalidate poniżej i tak odświeży
      // account-query; useAppRole dociągnie świeżą rolę przy najbliższym refetchu.
      try {
        await refetchSession();
      } catch {
        // Network down / token issue — caches below still refresh.
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.current,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.state,
      });
    },
  });
}
