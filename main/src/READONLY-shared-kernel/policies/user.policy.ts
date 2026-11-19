import { activeAccountStates } from '../domain/user-and-account/user_and_account.config';
import type {
  AccountStatus,
  StylistAccount,
} from '../models/db_models.generated.dto';
import {
  AccountStatusValue,
  PaymentStatusValue,
} from '../models/db_models.generated.dto';
import { PricingPlanValue } from '../domain/pricing/pricing.config';
// Type alias for functions that accept any user type with relations.
// STRUCTURAL (only the fields these predicates read), so it accepts both the server CurrentUser
// with the full row and the front's SafeCurrentUser with the `stylist_account` projection
// (session.dto.ts, SafeStylistAccount).
type AccountActivityFields = {
  account_status: AccountStatus;
  payment_status: StylistAccount['payment_status'];
  pricing_plan: StylistAccount['pricing_plan'];
  // Presence only. The row stores a Date; the session response stores an ISO string.
  plan_selected_at: unknown;
};

type UserWithRelationsOrCurrent =
  | {
      stylist_account: AccountActivityFields | null;
    }
  | undefined;

// SSOT membership test for the operationally-active account set. Both the
// status-level (IS_ACCOUNT_STATUS_ACTIVE) and user-level (IS_USER_HAS_ACTIVE_ACCOUNT)
// utils delegate here, so the active-set rule ([ACTIVE, EXPIRING]) lives in ONE place.
const isAccountStatusActive = (status: AccountStatus): boolean =>
  activeAccountStates.includes(status);

export type USER_POLICY_TYPE = {
  utils: {
    // Multi-state predicate: status ∈ activeAccountStates ([ACTIVE, EXPIRING]).
    // SSOT for the "account is operationally active" set on a BARE account_status.
    // NOTE: this is the MULTI-state notion (EXPIRING still counts), distinct from the
    // single-state `=== ACTIVE` public-visibility check (account.config.ts isAccountActive),
    // which is strictly ACTIVE-only. Do NOT conflate the two.
    IS_ACCOUNT_STATUS_ACTIVE: (status: AccountStatus) => boolean;
    IS_USER_HAS_ACTIVE_ACCOUNT: ({
      user,
    }: {
      user: UserWithRelationsOrCurrent;
    }) => boolean;
    IS_USER_NEED_TO_PAY_TO_ACTIVATE_ACCOUNT: ({
      user,
    }: {
      user: UserWithRelationsOrCurrent;
    }) => boolean;
    CAN_USER_HAVE_ACTIVE_ACCOUNT: ({
      user,
    }: {
      user: UserWithRelationsOrCurrent;
    }) => boolean;
  };
};
export const USER_POLICY: USER_POLICY_TYPE = {
  utils: {
    IS_ACCOUNT_STATUS_ACTIVE: status => isAccountStatusActive(status),

    IS_USER_HAS_ACTIVE_ACCOUNT: ({ user }) => {
      const hasUserWithActiveAccount =
        typeof user !== 'undefined' &&
        Boolean(user) &&
        Boolean(user.stylist_account) &&
        Boolean(
          user.stylist_account &&
          isAccountStatusActive(user.stylist_account.account_status)
        );

      return hasUserWithActiveAccount;
    },

    IS_USER_NEED_TO_PAY_TO_ACTIVATE_ACCOUNT: ({ user }) => {
      const isAccountInactiveAndUnpaid =
        user?.stylist_account?.account_status ===
          AccountStatusValue.NOT_ACTIVE &&
        user.stylist_account?.payment_status === PaymentStatusValue.UNPAID;

      return isAccountInactiveAndUnpaid;
    },

    CAN_USER_HAVE_ACTIVE_ACCOUNT: ({ user }) => {
      const account = user?.stylist_account;
      if (!account) {
        return false;
      }
      if (account.payment_status === PaymentStatusValue.PAID) {
        return true;
      }
      return (
        account.pricing_plan === PricingPlanValue.FREE &&
        account.plan_selected_at !== null
      );
    },
  },
} as const;
