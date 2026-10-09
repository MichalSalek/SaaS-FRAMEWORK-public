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
// STRUKTURALNY (tylko pola, które te predykaty czytają), żeby przyjmował zarówno
// serwerowy CurrentUser z pełnym wierszem, jak i SafeCurrentUser z projekcją
// `stylist_account` po stronie frontu (session.dto.ts, SafeStylistAccount).
type UserWithRelationsOrCurrent =
  | {
      stylist_account: Pick<
        StylistAccount,
        | 'account_status'
        | 'payment_status'
        | 'pricing_plan'
        | 'plan_selected_at'
      > | null;
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

    // DECISION (nie usuwaj tego komentarza):
    // Eligibility for an ACTIVE stylist account = paid subscription OR an onboarded
    // Free tier. Free accounts are legitimately ACTIVE (public profile online) with
    // payment_status=UNPAID (account-free-selection sets FREE + UNPAID + ACTIVE), so a
    // PAID-only gate silently drops them: on admin disable→enable / recovery-restore the
    // account_status reactivation was skipped, stranding a Free stylist at is_active=true
    // + account_status=NOT_ACTIVE (logged-in but publicly invisible, no self-heal —
    // free-select only reactivates from EXPIRED/EXPIRING, never NOT_ACTIVE). The
    // plan_selected_at guard (marker bramki D3) excludes never-onboarded accounts (default
    // pricing_plan before plan-select) so reactivation can't surface a never-configured
    // profile. Mirrors the states account-free-selection itself treats as active. Consumers:
    // enableUser_IO, reactivateAccount_IO (single) + cascadeBulkEnableAccountStatus (bulk,
    // replicates this predicate as a Prisma WHERE — keep in lockstep).
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
