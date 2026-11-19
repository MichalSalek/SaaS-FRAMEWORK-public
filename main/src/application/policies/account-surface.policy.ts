/**
 * Account Surface Policy (DDD): what the „Twoje konto" screen shows.
 *
 * The view follows the ACTIVE MODE, not account ownership. Active role = `account_type` from the
 * session („what I am in now"); ownership = `stylist_account` / `client_account` („what I have").
 * Mode decides WHAT is shown; ownership decides WHAT to offer (a second account or a role switch).
 * Gating sections on owning a stylist account showed a client-mode user the stylist's public
 * profile, plan and e-mail preferences.
 *
 * Pure module: no React, no window. Unit tested.
 */

import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import type { AccountType } from '@kernel/models/db_models.generated.dto';

export interface AccountSurfaceInputs {
  /**
   * Active session role. `null` = session not yet resolved OR an account without a role; both are
   * treated conservatively (no stylist sections), because showing someone else's settings is worse
   * than briefly showing none.
   */
  activeRole: AccountType | null;
  hasStylistAccount: boolean;
  hasClientAccount: boolean;
}

export interface AccountSurface {
  /** Public profile, plan, e-mail preferences, portfolio statistics. */
  showStylistSections: boolean;
  /** Billing: the plan section in the account plus the „Płatności" item in the desktop rail. */
  showBilling: boolean;
  /**
   * The „Polubione stylistki" tile counts the client's bookmarks; a stylist without a client account
   * would see a permanent zero next to a label she cannot use.
   */
  showFavoriteStylists: boolean;
  /** The role the user does NOT have: a prompt to create the second account. */
  offerMissingRole: AccountType | null;
  /**
   * A role the user HAS but is not currently in, so its settings are hidden. Set only for client
   * mode with a stylist account: the other way nothing is hidden (a client account has no sections
   * of its own), so a „switch" card would be noise.
   */
  offerRoleSwitchTo: AccountType | null;
}

export function resolveAccountSurface({
  activeRole,
  hasStylistAccount,
  hasClientAccount,
}: AccountSurfaceInputs): AccountSurface {
  const inStylistMode =
    activeRole === AccountTypeValue.STYLIST && hasStylistAccount;
  const inClientMode = activeRole === AccountTypeValue.CLIENT;

  let offerMissingRole: AccountType | null = null;
  if (inStylistMode && !hasClientAccount) {
    offerMissingRole = AccountTypeValue.CLIENT;
  } else if (inClientMode && !hasStylistAccount) {
    offerMissingRole = AccountTypeValue.STYLIST;
  }

  return {
    showStylistSections: inStylistMode,
    showBilling: inStylistMode,
    showFavoriteStylists: hasClientAccount,
    offerMissingRole,
    offerRoleSwitchTo:
      inClientMode && hasStylistAccount ? AccountTypeValue.STYLIST : null,
  };
}
