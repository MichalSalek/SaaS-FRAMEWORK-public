// UI/features/account/useAccountPageData.ts
// What every account settings screen (the section list and each section)
// needs before it can render: the signed-in user, the resolved session role
// and the surface policy. Section-specific queries (activity log, sessions,
// usage, invitations) stay inside their own section components, so a section
// mounts only its own queries.

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import { authClient } from '../../../application/auth/better-auth-client';
import {
  resolveAccountSurface,
  type AccountSurface,
} from '../../../application/policies/account-surface.policy';
import { useAuth } from '../../contexts/AuthContext.composition';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';

type AccountPageUser = NonNullable<
  ReturnType<typeof useCurrentUserAccount>['data']
>;

export type AccountPageData =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void; isRetrying: boolean }
  | {
      status: 'ready';
      user: AccountPageUser;
      surface: AccountSurface;
      /** Plan of the stylist account; null when the user has none. */
      pricingPlan: PricingPlan | null;
      displayName: string;
      logout: () => void;
    };

export function useAccountPageData(): AccountPageData {
  const queryClient = useQueryClient();
  const { logout, accountType } = useAuth();
  // The session carries the ACTIVE role; until it resolves the screen stays on the skeleton (see
  // the mount-gate below), else a dual-role user would see the other role's sections for a frame.
  const { isPending: isSessionPending } = authClient.useSession();
  const {
    data: user,
    isLoading,
    isFetching,
    refetch,
  } = useCurrentUserAccount();

  // DECISION: mount-gate. The account is auth-gated (Bearer token in localStorage) and SSR does not
  // know the session, so the query is disabled on the server (isLoading=false → error/content
  // branch) while the first client render has a token (isLoading=true → skeleton). It differs at
  // the top level and inside: UsageStats toLocaleString('pl-PL') (Node ICU ≠ browser ICU for
  // thousands separators) and AccountActivityPanel new Date() → "server HTML didn't match client".
  // SSR and the first CSR render the identical skeleton, content only after mount. Do NOT remove
  // `!mounted`.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || isLoading || isSessionPending) {
    return { status: 'loading' };
  }

  // Full error ONLY without data. On a failed background refresh (window focus, invalidation after
  // autosave) TanStack sets `isError` while KEEPING data; a condition on `isError` alone replaced the
  // whole screen with an error and unmounted the section together with unsaved drafts.
  if (!user) {
    return {
      status: 'error',
      retry: () => void refetch(),
      isRetrying: isFetching,
    };
  }

  // DECISION: the account view follows the session's ACTIVE ROLE, not account ownership. The gate
  // used to be `stylist_account != null`, so a dual-role user in client mode saw the stylist's
  // public card, plan and e-mail preferences ("on the client account I see identical settings as on
  // the stylist account"). The rule and its limits: application/policies/account-surface.policy.ts.
  // (owner)
  const surface = resolveAccountSurface({
    activeRole: accountType,
    hasStylistAccount:
      user.stylist_account !== null && user.stylist_account !== undefined,
    hasClientAccount:
      user.client_account !== null && user.client_account !== undefined,
  });

  // The header name follows the MODE (account-surface.policy): the card name belongs to stylist
  // mode; in client mode it is the account first name.
  const displayName =
    (surface.showStylistSections
      ? user.stylist_account?.display_name
      : undefined) ||
    user.name ||
    user.email.split('@')[0] ||
    '';

  return {
    status: 'ready',
    user,
    surface,
    pricingPlan: user.stylist_account?.pricing_plan ?? null,
    displayName,
    logout: () => {
      void queryClient.cancelQueries();
      queryClient.clear();
      logout();
    },
  };
}
