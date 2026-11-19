import { readLifecycleFrequency } from '@app/email-handler/lifecycle/frequency-window';
import { DB_CLIENT } from '@app/db/db.client';
import { resolveEffectivePlan_IO } from '@app/pricing/effective-plan.resolver';
import { lifecycleAddressHash } from '@app/email-handler/lifecycle/ledger';
import { TEST_USERS_CONFIG } from '@kernel/config/test-users.config';
import { TIME } from '@kernel/application/constants.config';
import type { FreeEmailState } from './free-email.resolver';

const excludedAddresses: ReadonlySet<string> = new Set(
  Object.values(TEST_USERS_CONFIG).map(user => user.email)
);

/** Fresh counts deliberately read visible, owned rows, never cached or salon photos. */
export const loadFreeEmailAudience_IO = async (
  accountId: string,
  now: Date
) => {
  const account = await DB_CLIENT.use.stylistAccount.findUnique({
    where: { account_id: accountId },
    include: { created_by_user: { include: { role: true } } },
  });
  if (!account) {
    return null;
  }
  const user = account.created_by_user;
  const [
    effective,
    photos,
    pinned,
    accepted,
    pending,
    suppression,
    checkout,
    paidHistory,
  ] = await Promise.all([
    resolveEffectivePlan_IO({ userId: user.id, ownPlan: account.pricing_plan }),
    DB_CLIENT.use.galleryRecord.count({
      where: { created_by_account_id: accountId, is_hidden: false },
    }),
    DB_CLIENT.use.galleryRecord.count({
      where: {
        created_by_account_id: accountId,
        is_hidden: false,
        is_pinned: true,
      },
    }),
    DB_CLIENT.use.clientStylistPair.count({
      where: { stylist_account_id: accountId, status: 'ACTIVE' },
    }),
    DB_CLIENT.use.clientStylistPair.count({
      where: {
        stylist_account_id: accountId,
        status: 'PENDING',
        stylist_hidden_at: null,
      },
    }),
    DB_CLIENT.use.emailDeliverySuppression.findUnique({
      where: { addressHash: lifecycleAddressHash(user.email) },
    }),
    // event-reader-writer-allow: checkout-session/index.ts writes this paid-checkout event via the auditEventName ternary passed to recordAuditEvent_IO.
    DB_CLIENT.use.eventLog.findFirst({
      where: {
        created_by_user_id: user.id,
        event: 'CHECKOUT_SESSION_CREATED',
        created_at: { gt: new Date(now.getTime() - TIME.MS_PER_DAY) },
      },
      select: { event_log_id: true },
    }),
    DB_CLIENT.use.eventLog.findFirst({
      where: {
        created_by_user_id: user.id,
        event: 'ADMIN_PRICING_PLAN_CHANGED',
        OR: [
          {
            event_payload: {
              path: ['oldPricingPlan'],
              string_starts_with: 'PRO',
            },
          },
          { event_payload: { path: ['oldPricingPlan'], equals: 'STUDIO' } },
          { event_payload: { path: ['oldPricingPlan'], equals: 'SCALE' } },
        ],
      },
      select: { event_log_id: true },
    }),
  ]);
  const state: FreeEmailState = {
    active:
      user.is_active &&
      user.disabled_at === null &&
      user.deleted_at === null &&
      account.account_status === 'ACTIVE',
    effectiveFree: effective.effective_pricing_plan === 'FREE',
    hasTrialHistory: account.trial_started_at !== null,
    hasPaidHistory:
      account.subscription_id !== null ||
      account.payment_status === 'PAID' ||
      paidHistory !== null,
    checkoutActive:
      checkout !== null ||
      account.payment_status === 'IN_PROGRESS' ||
      account.subscription_status === 'INCOMPLETE',
    tipsEnabled: account.email_trial_sequence,
    deliveryBlocked: suppression !== null,
    excluded:
      user.role.name === 'MASTER_ADMIN' ||
      excludedAddresses.has(user.email.toLowerCase()),
    visiblePhotoCount: photos,
    visiblePinnedCount: pinned,
    acceptedPairCount: accepted,
    pendingPairCount: pending,
  };
  return { account, state };
};

/** A preview uses the same persisted ledger plus the same legacy frequency event set. */
export const freeFrequencyPreview_IO = async (
  userId: string,
  now: Date
): Promise<string | null> => {
  const frequency = await readLifecycleFrequency(DB_CLIENT.use, userId, now);
  if (frequency) {
    return frequency === 'minimum_spacing' ? 'minimum_gap' : frequency;
  }
  if (now.getUTCHours() >= 21 || now.getUTCHours() < 9) {
    return 'quiet_hours';
  }
  return null;
};
