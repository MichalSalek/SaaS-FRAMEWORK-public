// UI/layouts/accountWebLayout.props.ts
// Składanie propsów AccountWebLayout (tożsamość + tłumaczenia + widoczność
// pozycji rail-nav) wyjęte z AppLayout: shell trzyma DECYZJĘ, którą powłokę
// wyrenderować, a nie budowę cudzych propsów. Czysta funkcja — bez Reacta,
// z tłumaczeniami podanymi jako gotowe stringi (i18n zostaje w komponencie).

import {
  getPlanDisplayName,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import type { AccountType } from '@kernel/models/db_models.generated.dto';
import { ACCOUNT_SECTIONS } from '../../application/policies/account-sections.config';
import { resolveAccountSurface } from '../../application/policies/account-surface.policy';
import { firstNonBlank } from '../shared/format/userDisplayName.formatters';
import type {
  AccountWebIdentity,
  AccountWebLayoutTranslations,
} from './AccountWebLayout.composition';

/** Wycinek `currentUser`, którego potrzebuje rail konta. */
interface AccountWebUser {
  name?: string | null;
  email?: string | null;
  stylist_account?: {
    display_name?: string | null;
    avatar_url?: string | null;
    pricing_plan?: PricingPlan | null;
  } | null;
  client_account?: unknown;
}

/** Klucze `layout.accountWeb`, z których składa się obiekt tłumaczeń raila. */
const ACCOUNT_WEB_TX_KEYS = [
  'eyebrow',
  'navAriaLabel',
  'navHome',
  'navProfile',
  'navAccount',
  'navBilling',
  'navSupport',
  // Sekcje ustawień konta = pod-pozycje „Konto" (account-sections.config).
  'sectionsAriaLabel',
  ...ACCOUNT_SECTIONS.map(def => def.labelKey),
  'productTitle',
  'androidLabel',
  'androidAriaLabel',
  'androidComingSoon',
  'logout',
] as const;

type AccountWebTxKey = (typeof ACCOUNT_WEB_TX_KEYS)[number];

/**
 * Obiekt tłumaczeń raila z translatora przestrzeni `layout.accountWeb`.
 * Wyjęte z AppLayout, żeby shell nie przepisywał kluczy jeden po
 * drugim; lista kluczy jest typowana, więc brak klucza to błąd kompilacji.
 */
export function buildAccountWebTranslations(
  tAccountWeb: (key: AccountWebTxKey) => string,
  skipToContent: string
): AccountWebLayoutTranslations {
  const entries = ACCOUNT_WEB_TX_KEYS.map(key => [key, tAccountWeb(key)]);
  return {
    ...(Object.fromEntries(entries) as Record<AccountWebTxKey, string>),
    skipToContent,
  };
}

export interface AccountWebPropsInput {
  currentUser: AccountWebUser | null | undefined;
  /** Aktywna rola sesji — rail idzie za trybem, nie za posiadaniem konta. */
  activeRole: AccountType | null;
  tx: AccountWebLayoutTranslations;
}

export interface AccountWebProps {
  identity: AccountWebIdentity | null;
  showBilling: boolean;
  showProfile: boolean;
  tx: AccountWebLayoutTranslations;
}

export function buildAccountWebProps({
  currentUser,
  activeRole,
  tx,
}: AccountWebPropsInput): AccountWebProps {
  const stylist = currentUser?.stylist_account ?? null;

  // Tryb klientki nie dostaje ani wizytówki, ani płatności, choćby user miał
  // konto stylistki (parytet z ekranem konta — account-surface.policy).
  const surface = resolveAccountSurface({
    activeRole,
    hasStylistAccount: stylist != null,
    hasClientAccount: currentUser?.client_account != null,
  });

  const identity: AccountWebIdentity | null = currentUser
    ? {
        // firstNonBlank, nie `??`: User.name domyślnie '' (klasa S67a), więc
        // łańcuch `??` zatrzymywał się na pustym stringu i rail pokazywał
        // pustą nazwę (a avatar inicjał „?").
        name:
          firstNonBlank(
            stylist?.display_name,
            currentUser.name,
            currentUser.email?.split('@')[0]
          ) ?? '',
        avatarUrl: stylist?.avatar_url ?? undefined,
        // Plan jest stylistowy: w trybie klientki rail go nie pokazuje, tak
        // samo jak ekran konta chowa plan i płatności (account-surface.policy).
        planLabel:
          surface.showBilling && stylist?.pricing_plan
            ? getPlanDisplayName(stylist.pricing_plan)
            : undefined,
      }
    : null;

  return {
    identity,
    showBilling: surface.showBilling,
    showProfile: surface.showStylistSections,
    tx,
  };
}
