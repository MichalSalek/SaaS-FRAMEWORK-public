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
  // Sesja niesie AKTYWNĄ rolę; dopóki się nie rozstrzygnie, ekran zostaje na
  // skeletonie (patrz mount-gate niżej) — inaczej dwurolowy user zobaczyłby
  // przez klatkę cudze sekcje.
  const { isPending: isSessionPending } = authClient.useSession();
  const {
    data: user,
    isLoading,
    isFetching,
    refetch,
  } = useCurrentUserAccount();

  // DECISION (nie usuwaj — S18 hydration fix): konto jest auth-gated (Bearer
  // token w localStorage), a SSR nie zna sesji => query disabled na serwerze
  // (isLoading=false -> branch error/content), a pierwszy client-render ma token
  // (isLoading=true -> skeleton). Roznica top-level + wewnatrz: UsageStats
  // toLocaleString('pl-PL') (Node ICU != browser ICU dla separatorow tysiecy) i
  // AccountActivityPanel new Date() => "server HTML didn't match client".
  // Mount-gate: SSR i first-CSR renderuja identyczny skeleton, tresc dopiero po
  // zamontowaniu. NIE usuwac `!mounted`.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || isLoading || isSessionPending) {
    return { status: 'loading' };
  }

  // Pełny błąd TYLKO bez danych. TanStack przy nieudanym odświeżeniu w tle
  // (fokus okna, invalidacja po autosave) ustawia `isError`, ZACHOWUJĄC dane —
  // warunek na samym `isError` zastępował cały ekran błędem i odmontowywał
  // sekcję razem z niezapisanymi szkicami.
  if (!user) {
    return {
      status: 'error',
      retry: () => void refetch(),
      isRetrying: isFetching,
    };
  }

  // DECISION (nie usuwaj tego komentarza) — owner 2026-09-09:
  // Widok konta idzie za AKTYWNĄ ROLĄ sesji, nie za posiadaniem konta. Wcześniej
  // bramka brzmiała `stylist_account != null`, więc dwurolowy user w trybie
  // klientki oglądał wizytówkę publiczną, plan i preferencje e-mail stylistki
  // („na koncie klientki widzę identyczne ustawienia jak na koncie stylistki").
  // Reguła i jej granice: application/policies/account-surface.policy.ts.
  const surface = resolveAccountSurface({
    activeRole: accountType,
    hasStylistAccount:
      user.stylist_account !== null && user.stylist_account !== undefined,
    hasClientAccount:
      user.client_account !== null && user.client_account !== undefined,
  });

  // Nazwa w nagłówku idzie za TRYBEM (account-surface.policy): nazwa
  // wizytówki należy do trybu stylistki; w trybie klientki to imię konta.
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
