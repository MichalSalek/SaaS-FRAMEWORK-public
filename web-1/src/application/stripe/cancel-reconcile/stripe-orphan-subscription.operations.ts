import type Stripe from 'stripe';

import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { getStripe } from '../adapters/stripe.adapter';
import {
  isScopedToNailfolio,
  isStripeSubscriptionActive,
} from '../stripe.config';
import { STRIPE_PROJECT_ID } from '../stripe.types';
import { extractPlanIdFromSubscription } from '../webhooks/stripe-webhooks.utils';
import {
  CANCEL_RECONCILE_EVENT_TYPE,
  buildCancelReconcileEventId,
  type CancelReconcileFlavor,
} from './stripe-cancel-reconcile.resolver';
import {
  ORPHAN_SCAN_MAX_PAGES,
  ORPHAN_SCAN_PAGE_SIZE,
  classifyOrphanSubscription,
  type OrphanScanAccount,
  type OrphanScanSubscription,
  type OrphanScanVerdict,
} from './stripe-orphan-subscription.resolver';

type ScannedSubscription = OrphanScanSubscription & {
  customerId: string | null;
  metadataAccountId: string | null;
};

type EnqueueTarget = {
  subscriptionId: string;
  userId: string;
  flavor: CancelReconcileFlavor;
  reason: string;
};

export type OrphanScanResult = {
  listed: number;
  live: number;
  foreign: number;
  capped: boolean;
  owned: number;
  skipped: number;
  enqueued: number;
  rearmed: number;
  alreadyPending: number;
  deadLettered: number;
  reports: Array<{ subscriptionId: string; reason: string }>;
};

/** DB `in` lists stay bounded: one query per chunk of this many ids. */
const DB_LOOKUP_CHUNK = ORPHAN_SCAN_PAGE_SIZE;

const customerIdOf = (subscription: Stripe.Subscription): string | null =>
  typeof subscription.customer === 'string'
    ? subscription.customer
    : (subscription.customer?.id ?? null);

const resolveScope = async (
  subscription: Stripe.Subscription
): Promise<boolean> => {
  const projectId = subscription.metadata?.projectId;
  if (projectId !== undefined && projectId !== STRIPE_PROJECT_ID) {
    return false;
  }
  const planId = await extractPlanIdFromSubscription(subscription);
  return isScopedToNailfolio(planId);
};

const listLiveSubscriptions = async (): Promise<{
  listed: number;
  live: ScannedSubscription[];
  foreign: number;
  capped: boolean;
}> => {
  const stripe = getStripe();
  const live: ScannedSubscription[] = [];
  let listed = 0;
  let foreign = 0;
  let startingAfter: string | undefined;
  let hasMore = true;

  for (let page = 0; page < ORPHAN_SCAN_MAX_PAGES && hasMore; page += 1) {
    // Default list status = every non-canceled subscription; filtered below to
    // the statuses that still charge (STRIPE_ACTIVE_STATUSES).
    const response = await stripe.subscriptions.list({
      limit: ORPHAN_SCAN_PAGE_SIZE,
      ...(startingAfter !== undefined && { starting_after: startingAfter }),
    });
    listed += response.data.length;
    hasMore = response.has_more;
    startingAfter = response.data.at(-1)?.id;
    if (startingAfter === undefined) {
      hasMore = false;
    }

    for (const subscription of response.data) {
      if (!isStripeSubscriptionActive({ status: subscription.status })) {
        continue;
      }
      const scoped = await resolveScope(subscription);
      if (!scoped) {
        foreign += 1;
        continue;
      }
      live.push({
        id: subscription.id,
        created: subscription.created,
        cancelAtPeriodEnd:
          subscription.cancel_at_period_end || subscription.cancel_at != null,
        scoped,
        customerId: customerIdOf(subscription),
        metadataAccountId: subscription.metadata?.accountId ?? null,
      });
    }
  }

  return { listed, live, foreign, capped: hasMore };
};

const ACCOUNT_SELECT = {
  account_id: true,
  subscription_id: true,
  stripe_customer_id: true,
  pricing_plan: true,
  payment_status: true,
  admin_plan_override: true,
  created_by_user: { select: { id: true, is_active: true, deleted_at: true } },
} as const;

type AccountRow = OrphanScanAccount & { stripeCustomerId: string | null };

const loadAccounts = async (
  subscriptions: readonly ScannedSubscription[]
): Promise<AccountRow[]> => {
  const rows: AccountRow[] = [];
  for (let i = 0; i < subscriptions.length; i += DB_LOOKUP_CHUNK) {
    const chunk = subscriptions.slice(i, i + DB_LOOKUP_CHUNK);
    const customerIds = chunk.flatMap(s =>
      s.customerId === null ? [] : [s.customerId]
    );
    const accountIds = chunk.flatMap(s =>
      s.metadataAccountId === null ? [] : [s.metadataAccountId]
    );
    // DECISION: every OR leg is indexed (`stripe_customer_id` @unique, `account_id` PK,
    // `subscription_id` @@index), so Postgres answers each leg with an index scan and BitmapOr
    // instead of scanning stylist_account per chunk. See SCHEMA_DECISIONS.md#stylistaccount-subscription-id-index.
    const found = await DB_CLIENT.use.stylistAccount.findMany({
      where: {
        OR: [
          { stripe_customer_id: { in: customerIds } },
          { account_id: { in: accountIds } },
          { subscription_id: { in: chunk.map(s => s.id) } },
        ],
      },
      select: ACCOUNT_SELECT,
      take: DB_LOOKUP_CHUNK * 3,
    });
    for (const account of found) {
      rows.push({
        accountId: account.account_id,
        subscriptionId: account.subscription_id,
        stripeCustomerId: account.stripe_customer_id,
        pricingPlan: account.pricing_plan,
        paymentStatus: account.payment_status,
        adminPlanOverride: account.admin_plan_override,
        ownerUserId: account.created_by_user.id,
        ownerIsActive: account.created_by_user.is_active,
        ownerDeletedAt: account.created_by_user.deleted_at,
      });
    }
  }
  return rows;
};

const dedupeAccounts = (rows: readonly AccountRow[]): AccountRow[] => [
  ...new Map(rows.map(row => [row.accountId, row])).values(),
];

const REASON_TEXT: Record<
  Extract<OrphanScanVerdict, { kind: 'enqueue' }>['reason'],
  string
> = {
  deleted_owner:
    'Orphan scan: live subscription of a soft-deleted user (deletion cancel never recorded)',
  admin_downgrade:
    'Orphan scan: live subscription on an admin-downgraded FREE account (downgrade cancel never recorded)',
  superseded:
    'Orphan scan: live subscription superseded by a newer linked one (duplicate-checkout cancel never recorded)',
};

const persistTargets = async (
  targets: readonly EnqueueTarget[]
): Promise<
  Pick<
    OrphanScanResult,
    'enqueued' | 'rearmed' | 'alreadyPending' | 'deadLettered'
  >
> => {
  const counts = {
    enqueued: 0,
    rearmed: 0,
    alreadyPending: 0,
    deadLettered: 0,
  };
  if (targets.length === 0) {
    return counts;
  }
  const byEventId = new Map(
    targets.map(target => [
      buildCancelReconcileEventId({
        subscriptionId: target.subscriptionId,
        userId: target.userId,
        flavor: target.flavor,
      }),
      target,
    ])
  );
  const eventIds = [...byEventId.keys()];
  const existing = await DB_CLIENT.use.stripeEvent.findMany({
    where: { event_id: { in: eventIds } },
    select: { event_id: true, processed: true, dead_lettered: true },
    take: eventIds.length,
  });
  const existingById = new Map(existing.map(row => [row.event_id, row]));

  const toCreate: Array<{
    event_id: string;
    event_type: string;
    last_error: string;
  }> = [];
  for (const [eventId, target] of byEventId) {
    const row = existingById.get(eventId);
    if (row === undefined) {
      toCreate.push({
        event_id: eventId,
        event_type: CANCEL_RECONCILE_EVENT_TYPE,
        last_error: target.reason,
      });
      continue;
    }
    if (row.dead_lettered) {
      counts.deadLettered += 1;
      continue;
    }
    if (!row.processed) {
      counts.alreadyPending += 1;
      continue;
    }
    // Conditional on the state we read, so a concurrent sweep that re-opened or
    // dead-lettered the row in between is never overwritten.
    const rearmed = await DB_CLIENT.use.stripeEvent.updateMany({
      where: { event_id: eventId, processed: true, dead_lettered: false },
      data: {
        processed: false,
        processed_at: null,
        retry_count: 0,
        last_attempt_at: new Date(),
        last_error: target.reason,
      },
    });
    counts.rearmed += rearmed.count;
  }

  if (toCreate.length > 0) {
    // skipDuplicates: a concurrent enqueue of the same key must not fail the batch.
    const created = await DB_CLIENT.use.stripeEvent.createMany({
      data: toCreate,
      skipDuplicates: true,
    });
    counts.enqueued = created.count;
  }
  return counts;
};

/**
 * One scan: list live Nailfolio subscriptions, classify each against its owner,
 * persist the cancel obligations the classification found. Throws on a Stripe or DB
 * failure; the sweep factory catches and reports it, and the next run starts over.
 */
export const scanOrphanedSubscriptions =
  async (): Promise<OrphanScanResult> => {
    const now = new Date();
    const { listed, live, foreign, capped } = await listLiveSubscriptions();

    const liveCreatedById = new Map(live.map(s => [s.id, s.created]));
    const accounts = dedupeAccounts(await loadAccounts(live));

    const result: OrphanScanResult = {
      listed,
      live: live.length,
      foreign,
      capped,
      owned: 0,
      skipped: 0,
      enqueued: 0,
      rearmed: 0,
      alreadyPending: 0,
      deadLettered: 0,
      reports: [],
    };
    const targets: EnqueueTarget[] = [];

    for (const subscription of live) {
      const verdict = classifyOrphanSubscription({
        subscription,
        referencingAccounts: accounts.filter(
          account => account.subscriptionId === subscription.id
        ),
        ownerByCustomer:
          subscription.customerId === null
            ? null
            : (accounts.find(
                account => account.stripeCustomerId === subscription.customerId
              ) ?? null),
        ownerByMetadata:
          subscription.metadataAccountId === null
            ? null
            : (accounts.find(
                account => account.accountId === subscription.metadataAccountId
              ) ?? null),
        liveCreatedById,
        now,
      });

      switch (verdict.kind) {
        case 'owned':
          result.owned += 1;
          break;
        case 'foreign':
        case 'winding_down':
        case 'too_young':
          result.skipped += 1;
          break;
        case 'report':
          result.reports.push({
            subscriptionId: subscription.id,
            reason: verdict.reason,
          });
          break;
        case 'enqueue':
          targets.push({
            subscriptionId: subscription.id,
            userId: verdict.userId,
            flavor: verdict.flavor,
            reason: REASON_TEXT[verdict.reason],
          });
          break;
        default: {
          const exhaustive: never = verdict;
          void exhaustive;
        }
      }
    }

    Object.assign(result, await persistTargets(targets));

    if (targets.length > 0) {
      reportIssueBackend({
        namespace: 'STRIPE_ORPHAN_SUBSCRIPTION_ENQUEUED',
        message:
          'Orphan scan recorded cancel obligations for subscriptions no code path was cancelling',
        payload: { targets },
        mode: 'warn',
      });
    }
    return result;
  };
