import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type { CheckoutFreePlanConflictError } from '@kernel/domain/user-and-account/account-errors.types';
import type {
  AccountNotFoundError,
  DatabaseError,
} from '@kernel/application/common-errors.types';
import {
  AccountStatusValue,
  PaymentStatusValue,
  SubscriptionStatusValue,
  type SubscriptionStatus,
} from '@kernel/models/db_models.generated.dto';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { casUpdate } from '@app/db/cas';

// DECISION (nie usuwaj tego komentarza):
// "Aktywna płatna subskrypcja" = subscription_id != null AND status w stanach
// dających dostęp (ACTIVE/TRIALING/PAST_DUE — mirror STRIPE_ACTIVE_STATUSES).
// CANCELED/UNPAID/PAUSED/INCOMPLETE* = brak aktywnej subskrypcji -> free-select OK.
// Downgrade z aktywnej płatnej idzie przez portal/cancel (NIE przez free-branch).
const ACTIVE_PAID_SUBSCRIPTION_STATUS_LIST: readonly SubscriptionStatus[] = [
  SubscriptionStatusValue.ACTIVE,
  SubscriptionStatusValue.TRIALING,
  SubscriptionStatusValue.PAST_DUE,
];
const ACTIVE_PAID_SUBSCRIPTION_STATUSES: ReadonlySet<SubscriptionStatus> =
  new Set(ACTIVE_PAID_SUBSCRIPTION_STATUS_LIST);

/**
 * SPE — wybór planu FREE bez Stripe (zero customer/session/karty).
 *
 * Idempotentny. Ustawia pricing_plan=FREE + plan_selected_at (marker bramki D3) +
 * payment_status=UNPAID (FREE nie ma płatności). NIE rusza trial_started_at
 * (zachowuje historię zużycia triala). Konflikt = aktywna płatna subskrypcja.
 */
export const selectFreePlan_IO = async ({
  userId,
}: {
  userId: string;
}): Promise<
  OperationResult<
    Record<string, never>,
    CheckoutFreePlanConflictError | AccountNotFoundError | DatabaseError
  >
> => {
  let user;
  try {
    user = await DB_CLIENT.use.user.findUnique({
      where: { id: userId },
      select: {
        stylist_account: {
          select: {
            account_id: true,
            subscription_id: true,
            subscription_status: true,
          },
        },
      },
    });
  } catch (error) {
    return databaseFailure('selectFreePlan:fetchUser', error);
  }

  if (!user?.stylist_account) {
    return failure({ type: 'ACCOUNT_NOT_FOUND', accountId: userId });
  }

  const account = user.stylist_account;

  const hasActivePaidSubscription =
    account.subscription_id != null &&
    account.subscription_status != null &&
    ACTIVE_PAID_SUBSCRIPTION_STATUSES.has(account.subscription_status);

  if (hasActivePaidSubscription) {
    return failure({
      type: 'CHECKOUT_FREE_PLAN_CONFLICT',
      accountId: account.account_id,
    });
  }

  // DECISION (nie usuwaj tego komentarza) — CAS (finding ioA-2): wczesniejszy findUnique-then-
  // bezwarunkowy update mial wyscig — webhook Stripe (customer.subscription.created) mogl scommitowac
  // subscription_id + ACTIVE MIEDZY read a update, a bezwarunkowy update klobrowal go z powrotem na
  // FREE/UNPAID (Stripe nalicza, lokalnie FREE -> entitlement mismatch). Teraz updateMany z guardem
  // "BRAK aktywnej platnej subskrypcji W CZASIE ZAPISU" (subscription_id NULL OR status NULL OR status
  // NOT IN active-set) -> count atomowo odzwierciedla precondition. count===0 = guard nie trzymal:
  // re-fetch klasyfikuje (konto zniklo -> ACCOUNT_NOT_FOUND vs webhook aktywowal platny -> CONFLICT).
  // NIE ruszamy last_stripe_event_at: Free to NIE Stripe-event; recency-guard rodziny subscription-
  // writers to OSOBNY temat (inwentaryzacja updateAccountPlanStatus, nie ten fix).
  // DECISION (nie usuwaj tego komentarza) — free-transition INVARIANT parity (turbo-review S64):
  // manual FREE-select MUSI reaktywować lapsed-konto tak jak dwie automatyczne ścieżki free-
  // transition (dunning-downgrade + subscription-deleted, oba przez updateAccountPlanStatus z
  // account_status=ACTIVE + current_period_end=null). Bez tego konto zamiecione do EXPIRED
  // (subscription_status=CANCELED + current_period_end<now, expiry-sweep) po ręcznym wyborze FREE
  // zostawało FREE+EXPIRED → niewidoczne w discovery (STYLIST_PUBLICLY_VISIBLE wymaga ACTIVE) i
  // operacyjnie zablokowane (IS_ACCOUNT_STATUS_ACTIVE=[ACTIVE,EXPIRING]), mimo ważnego darmowego
  // planu; a bez current_period_end=null następny daily expiry-sweep RE-FLIPował je z powrotem
  // (EXPIRED-branch matchuje subscription_status=CANCELED AND current_period_end<now) — pętla
  // niewidoczności. DWA KROKI w JEDNEJ $transaction (atomowo, brak stanu częściowego):
  //  (1) primary CAS-write — pricing_plan/payment_status/current_period_end=null/plan_selected_at
  //      z NIEZMIENIONYM CAS-guardem (BRAK aktywnej płatnej subskrypcji W CZASIE ZAPISU: sub_id
  //      NULL OR status NULL OR status NOT IN active-set → count atomowo = precondition; count===0
  //      = webhook aktywował płatny MIĘDZY read a write → CONFLICT / konto zniknęło → NOT_FOUND).
  //      current_period_end=null bezpieczne dla KAŻDEGO stanu (nie reaktywuje, tylko wywala
  //      predykat expiry-sweep w 3VL). NIE ruszamy last_stripe_event_at (Free ≠ Stripe-event).
  //  (2) scoped reactivation — account_status=ACTIVE TYLKO ze stanów subscription-lapse
  //      (EXPIRED/EXPIRING) i tylko gdy created_by_user.is_active=true. To CELOWO NIE dotyka
  //      NOT_ACTIVE: ten stan ustawia admin-moderacja (moderation BAN), admin-bulk-disable ORAZ
  //      charge-dispute.handler (NOT_ACTIVE + „manual review required", BEZ is_active=false → user
  //      dociera do free-select). Bezwarunkowe account_status=ACTIVE OD-BANOWAŁOBY / zdjęło hold
  //      sporu płatniczego przez wybór FREE — regresja. Wzorzec is_active-guarda 1:1 z
  //      cascadeBulkEnableAccountStatus (unika mismatchu account_status=ACTIVE przy is_active=false).
  //      subscription_id/subscription_status ŚWIADOMIE nietknięte (nulowanie potencjalnie-żywego
  //      nieaktywnego suba w Stripe = ryzyko orphana; obie szkody domyka current_period_end).
  //      Onboarding-free-select (już ACTIVE) = no-op w kroku (2).
  let updatedCount;
  try {
    updatedCount = await DB_CLIENT.use.$transaction(async tx => {
      const primaryCount = await casUpdate(() =>
        tx.stylistAccount.updateMany({
          where: {
            account_id: account.account_id,
            OR: [
              { subscription_id: null },
              { subscription_status: null },
              {
                subscription_status: {
                  notIn: [...ACTIVE_PAID_SUBSCRIPTION_STATUS_LIST],
                },
              },
            ],
          },
          data: {
            pricing_plan: PricingPlanValue.FREE,
            payment_status: PaymentStatusValue.UNPAID,
            current_period_end: null,
            plan_selected_at: new Date(),
          },
        })
      );

      if (primaryCount > 0) {
        await tx.stylistAccount.updateMany({
          where: {
            account_id: account.account_id,
            account_status: {
              in: [AccountStatusValue.EXPIRED, AccountStatusValue.EXPIRING],
            },
            created_by_user: { is_active: true },
          },
          data: { account_status: AccountStatusValue.ACTIVE },
        });
      }

      return primaryCount;
    });
  } catch (error) {
    return databaseFailure('selectFreePlan:update', error);
  }

  if (updatedCount === 0) {
    let recheck;
    try {
      recheck = await DB_CLIENT.use.stylistAccount.findUnique({
        where: { account_id: account.account_id },
        select: { account_id: true },
      });
    } catch (error) {
      return databaseFailure('selectFreePlan:reclassify', error);
    }
    if (!recheck) {
      return failure({ type: 'ACCOUNT_NOT_FOUND', accountId: userId });
    }
    return failure({
      type: 'CHECKOUT_FREE_PLAN_CONFLICT',
      accountId: account.account_id,
    });
  }

  return success({});
};
