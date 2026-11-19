// UI/layouts/accountWebLayout.props.ts
// Builds the AccountWebLayout props (identity + translations + rail-nav item visibility),
// extracted from AppLayout: the shell holds the DECISION which shell to render, not the
// construction of another component's props. Pure function: no React, translations passed
// as ready strings (i18n stays in the component).

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

/** The slice of `currentUser` the account rail needs. */
interface AccountWebUser {
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  image?: string | null;
  is_active?: boolean | null;
  stylist_account?: {
    display_name?: string | null;
    avatar_url?: string | null;
    pricing_plan?: PricingPlan | null;
  } | null;
  client_account?: unknown;
}

/** The `layout.accountWeb` keys that make up the rail's translation object. */
const ACCOUNT_WEB_TX_KEYS = [
  'eyebrow',
  'navAriaLabel',
  'navHome',
  'navNotifications',
  'navProfile',
  'navAccount',
  'navBilling',
  'navSupport',
  // Account settings sections = sub-items of „Konto" (account-sections.config).
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
 * Rail translation object from the `layout.accountWeb` translator. The key list is typed,
 * so a missing key is a compile error and the shell does not copy keys one by one.
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
  /** Active session role: the rail follows the mode, not account ownership. */
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

  // Client mode gets neither the profile card nor billing, even if the user has a stylist
  // account (parity with the account screen, account-surface.policy).
  const surface = resolveAccountSurface({
    activeRole,
    hasStylistAccount: stylist != null,
    hasClientAccount: currentUser?.client_account != null,
  });

  const identity: AccountWebIdentity | null = currentUser
    ? {
        // firstNonBlank, not `??`: User.name defaults to '', so a `??` chain would stop at the
        // empty string and the rail would show an empty name (and a „?" avatar initial).
        name:
          firstNonBlank(currentUser.name, currentUser.email?.split('@')[0]) ??
          '',
        avatarUrl: currentUser.avatar_url ?? undefined,
        avatarFallbackUrl: currentUser.image ?? undefined,
        // The plan is a stylist thing: in client mode the rail hides it, as the account screen
        // hides plan and billing (account-surface.policy).
        planLabel:
          surface.showBilling && stylist?.pricing_plan
            ? getPlanDisplayName(stylist.pricing_plan)
            : undefined,
        // Only a positively live account lets the rail poll its badge.
        isActive: currentUser.is_active === true,
      }
    : null;

  return {
    identity,
    showBilling: surface.showBilling,
    showProfile: surface.showStylistSections,
    tx,
  };
}
