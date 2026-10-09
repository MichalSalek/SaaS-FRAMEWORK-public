/**
 * Trial-Email Sweep Operation (domain/email)
 *
 * SRP: the trial-email sub-sweep of the email lifecycle orchestrator.
 * Queries genuine in-trial stylist accounts, batch-resolves the shared lookup
 * structures (pairing counts, locales, frequency counts, already-sent events),
 * then sends due trial-sequence emails per account under bounded concurrency.
 *
 * DECISION (nie usuwaj tego komentarza): pure-domain email lifecycle logic — moved
 * from application/email-handler/lifecycle/ to domain/email/operations/ (FWE Wave E)
 * to sit beside its sibling lifecycle operations (renewal-reminder, winback-deletion).
 * Like those siblings, this domain operation orchestrates IO via @app infra
 * (DB_CLIENT, email-transport, frequency.guard) — the established pattern for the
 * email lifecycle domain. Originally extracted from email-lifecycle.orchestrator.ts
 * (BDX W4.2): the eslint.config.mjs concern ("cannot be easily split without passing
 * large shared structures across module boundaries") is addressed, not broken — the
 * shared structures (accounts + 4 lookup maps) cross the module boundary as one typed
 * `TrialSweepContext` struct passed to `processTrialAccount`. The context is built once
 * (`sendTrialEmails_IO`) and passed by reference, with NO per-account reconstruction.
 * The orchestrator stays a thin dispatcher.
 */

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { PairingStatusValue } from '@kernel/models/db_models.generated.dto';
import { TIME } from '@kernel/application/constants.config';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import {
  EMAIL_LIFECYCLE_CONFIG,
  EMAIL_SWEEP_TUNING,
  POST_TRIAL_AUDIENCE_WINDOW_DAYS,
  TRIAL_EMAIL_SCHEDULE,
  CANCEL_EMAIL_SCHEDULE,
  DUNNING_EMAIL_SCHEDULE,
} from '@kernel/domain/email/email-schedule.config';
import type { LocaleType } from '@kernel/domain/i18n/i18n.config';
import {
  SubscriptionStatusValue,
  EventLogTypeValue,
} from '@kernel/models/db_models.generated.dto';
import { isEventInfoNarrower } from '@kernel/models/type_narrowing';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import {
  NON_CONVERTED_PAYMENT_STATUSES,
  NON_CONVERTED_SUBSCRIPTION_STATUSES,
  trialDueStartWindows,
} from '@domain/email/trial-audience.policy';
import { runWithConcurrency } from '@app/utils/concurrency.utils';
import { batchGetEmailFrequencyCounts_IO } from '@app/email-handler/lifecycle/email-frequency.guard';
import { batchResolveLocales } from '@app/email-handler/lifecycle/email-locale-batch.resolver';

/** Result of the trial-email sweep phase. */
export type TrialSweepResult = {
  /** Number of trial-sequence emails actually sent this sweep. */
  readonly emailsSent: number;
  /** Number of trial accounts the phase processed (0 = nothing queried). */
  readonly accountsProcessed: number;
};

const TRIAL_TRIGGER_DAYS = TRIAL_EMAIL_SCHEDULE.map(rule => rule.triggerDay);

/** Trial account row shape returned by the sweep query. */
export type TrialAccountRow = Awaited<
  ReturnType<typeof queryTrialAccounts>
>[number];

/**
 * Explicit shared-state struct for the trial sweep.
 *
 * DECISION (nie usuwaj tego komentarza): istnieje WYŁĄCZNIE po to, by dzielone mapy
 * lookup przekraczały granicę modułu jako jeden typowany parametr (nie luźny worek
 * argumentów ani closure). To jest mechanizm, którym split orchestratora adresuje
 * dawny zarzut "large shared structures across module boundaries".
 */
export type TrialSweepContext = {
  /** Trial accounts queried this sweep (snapshot, order = trial_started_at asc). */
  readonly accounts: readonly TrialAccountRow[];
  /** stylist_account_id → paired-clients count (0 if absent). */
  readonly pairingCountMap: ReadonlyMap<string, number>;
  /** userId → resolved locale (caller falls back to 'pl' if absent). */
  readonly localeMap: ReadonlyMap<string, LocaleType>;
  /** userId → non-transactional email count in the trailing window (frequency cap). */
  readonly frequencyCountMap: ReadonlyMap<string, number>;
  /**
   * userId → Set of INFO events already sent.
   *
   * DECISION (nie usuwaj tego komentarza): jako JEDYNA z map celowo NIE jest
   * `ReadonlyMap` — jej Set-y są mutowane w trakcie iteracji (`sentEvents.add(...)`
   * po udanym wysłaniu), żeby ten sam sweep nie wysłał duplikatu reguły. Bezpieczne:
   * każdy userId występuje w `accounts` co najwyżej raz, a `runWithConcurrency` partycjonuje
   * pracę per-account, więc nie ma cross-worker contention na wspólnym Set.
   */
  readonly sentEventsMap: Map<string, Set<EVENT_INFO_TYPE>>;
  /** userId → paid plan the trial ended on, for accounts already on FREE. */
  readonly endedTrialPlanMap: ReadonlyMap<string, PricingPlan>;
};

/**
 * Trial audience (mirrors trial-audience.policy.ts).
 *
 * In trial: trial dates set, trial_ends_at still in the future, subscription
 * TRIALING. trialing maps to payment_status PAID, so a `not: PAID` filter
 * matches nobody. subscription_status=null is not a live trial after SPE
 * (handleTrialFieldsUpdate runs only for status trialing, after the same
 * webhook wrote TRIALING).
 *
 * Post-trial window: trial_ends_at within POST_TRIAL_AUDIENCE_WINDOW_DAYS, and
 * the account did not convert (FREE plan, terminal/failed subscription, or
 * failed payment). Still-TRIALING after the clock is excluded until the
 * conversion webhook lands.
 */
export const queryTrialAccounts = (
  now: Date,
  afterAccountId: string | null
) => {
  const postTrialSince = new Date(
    now.getTime() - POST_TRIAL_AUDIENCE_WINDOW_DAYS * TIME.MS_PER_DAY
  );
  return DB_CLIENT.use.stylistAccount.findMany({
    where: {
      trial_started_at: { not: null },
      created_by_user: {
        is_active: true,
      },
      AND: [
        {
          // Only accounts with a rule inside its catch-up window right now;
          // the rest cannot be mailed and would only take page slots.
          OR: trialDueStartWindows(TRIAL_TRIGGER_DAYS, now).map(window => ({
            trial_started_at: window,
          })),
        },
        {
          OR: [
            {
              trial_ends_at: { gt: now },
              subscription_status: SubscriptionStatusValue.TRIALING,
            },
            {
              trial_ends_at: { gte: postTrialSince, lte: now },
              OR: [
                { pricing_plan: PricingPlanValue.FREE },
                {
                  subscription_status: {
                    in: [...NON_CONVERTED_SUBSCRIPTION_STATUSES],
                  },
                },
                {
                  payment_status: {
                    in: [...NON_CONVERTED_PAYMENT_STATUSES],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    // account_id breaks ties so the cursor walks a total order.
    orderBy: [{ trial_started_at: 'asc' }, { account_id: 'asc' }],
    ...(afterAccountId !== null
      ? { cursor: { account_id: afterAccountId }, skip: 1 }
      : {}),
    select: {
      account_id: true,
      trial_started_at: true,
      trial_ends_at: true,
      payment_status: true,
      subscription_status: true,
      pricing_plan: true,
      display_name: true,
      email_preferences: true,
      email_marketing: true,
      email_trial_sequence: true,
      stripe_customer_id: true,
      subscription_id: true,
      cancel_at_period_end: true,
      created_by_user_id: true,
      created_by_user: {
        select: {
          is_active: true,
          email: true,
          name: true,
        },
      },
      _count: {
        select: {
          gallery_record: true,
        },
      },
    },
    take: EMAIL_LIFECYCLE_CONFIG.MAX_EMAILS_PER_SWEEP,
  });
};

/**
 * Build the per-sweep shared lookup structures from the queried accounts.
 * Single batched query each (N+1 prevention; M12/H13 fixes preserved).
 */
export const buildTrialSweepContext = async (
  accounts: readonly TrialAccountRow[]
): Promise<TrialSweepContext> => {
  const accountIds = accounts.map(a => a.account_id);
  const userIds = accounts.map(a => a.created_by_user_id);

  // Batch fetch paired clients count for all accounts
  // Filtr ACTIVE (stały QR 2026-07-11): bez niego liczba „sparowanych
  // klientek" w mailach zawierała prośby PENDING (i historyczne REVOKED) —
  // stylistka z 0 par i 6 prośbami z plakatu dostawała „masz 6 klientek".
  const pairingCounts = await DB_CLIENT.use.clientStylistPair.groupBy({
    by: ['stylist_account_id'],
    where: {
      stylist_account_id: { in: accountIds },
      status: PairingStatusValue.ACTIVE,
    },
    _count: true,
  });
  const pairingCountMap = new Map(
    pairingCounts.map(p => [p.stylist_account_id, p._count])
  );

  // Batch fetch sent EMAIL events for ALL accounts (N+1 prevention)
  const knownEmailEvents = [
    ...TRIAL_EMAIL_SCHEDULE.map(r => r.infoEvent),
    ...CANCEL_EMAIL_SCHEDULE.map(r => r.infoEvent),
    ...DUNNING_EMAIL_SCHEDULE.map(r => r.infoEvent),
  ];
  const sentEmailLogs = await DB_CLIENT.use.eventLog.findMany({
    where: {
      event_type: EventLogTypeValue.EMAIL,
      created_by_user_id: { in: userIds },
      event: { in: knownEmailEvents },
    },
    select: {
      created_by_user_id: true,
      event: true,
    },
    // Cap regardless of userIds.length — guards against runaway query if the
    // batch grows or schedule expands. Tuning lives in EMAIL_SWEEP_TUNING (SSOT):
    // EVENTS_LOOKBACK_PER_USER covers ~10 schedules × multiple sends per user.
    take: Math.min(
      userIds.length * EMAIL_SWEEP_TUNING.EVENTS_LOOKBACK_PER_USER,
      EMAIL_SWEEP_TUNING.MAX_EVENTS_PER_QUERY
    ),
  });

  // Batch-resolve locales + frequency counts (M12/H13 — single query each instead of N)
  const localeMap = await batchResolveLocales(userIds);
  const frequencyCountMap = await batchGetEmailFrequencyCounts_IO(userIds);

  // Build Map<userId, Set<eventName>> for O(1) lookup.
  // Narrow log.event (raw Prisma string) to EVENT_INFO_TYPE — corrupt rows are skipped
  // rather than poisoning the Set with non-domain strings.
  const sentEventsMap = new Map<string, Set<EVENT_INFO_TYPE>>();
  for (const log of sentEmailLogs) {
    if (!isEventInfoNarrower(log.event)) {
      continue;
    }
    const set = sentEventsMap.get(log.created_by_user_id);
    if (set) {
      set.add(log.event);
    } else {
      sentEventsMap.set(log.created_by_user_id, new Set([log.event]));
    }
  }

  const freeUserIds = accounts
    .filter(account => account.pricing_plan === PricingPlanValue.FREE)
    .map(account => account.created_by_user_id);
  const endedTrialPlanMap = await batchEndedTrialPlans(freeUserIds);

  return {
    accounts,
    pairingCountMap,
    localeMap,
    frequencyCountMap,
    sentEventsMap,
    endedTrialPlanMap,
  };
};

const PAID_PLAN_NAMES: ReadonlySet<string> = new Set([
  PricingPlanValue.PRO,
  PricingPlanValue.PRO_PLUS,
  PricingPlanValue.STUDIO,
]);

const isPricingPlan = (value: unknown): value is PricingPlan =>
  typeof value === 'string' && PAID_PLAN_NAMES.has(value);

/**
 * Latest Stripe downgrade to FREE per user. The payload is the raw
 * ADMIN_PRICING_PLAN_CHANGED body (oldPricingPlan / newPricingPlan / source),
 * not the responseBody wrapper used by email dedup events.
 */
const batchEndedTrialPlans = async (
  userIds: readonly string[]
): Promise<Map<string, PricingPlan>> => {
  const map = new Map<string, PricingPlan>();
  if (userIds.length === 0) {
    return map;
  }
  const logs = await DB_CLIENT.use.eventLog.findMany({
    where: {
      created_by_user_id: { in: [...userIds] },
      event: APP_EVENTS.INFO.ADMIN.ADMIN_PRICING_PLAN_CHANGED,
      event_type: EventLogTypeValue.ACCOUNT,
    },
    orderBy: { created_at: 'desc' },
    select: { created_by_user_id: true, event_payload: true },
    take: Math.min(userIds.length * 5, EMAIL_SWEEP_TUNING.MAX_EVENTS_PER_QUERY),
  });
  for (const log of logs) {
    if (map.has(log.created_by_user_id)) {
      continue;
    }
    const payload = log.event_payload;
    if (payload == null || typeof payload !== 'object') {
      continue;
    }
    const record = payload as Record<string, unknown>;
    if (
      record['newPricingPlan'] === PricingPlanValue.FREE &&
      record['source'] === 'stripe' &&
      isPricingPlan(record['oldPricingPlan'])
    ) {
      map.set(log.created_by_user_id, record['oldPricingPlan']);
    }
  }
  return map;
};

import { processTrialAccount } from './trial-account.send';

export const sendTrialEmails_IO = async (): Promise<TrialSweepResult> => {
  const now = new Date();
  const pageSize = EMAIL_LIFECYCLE_CONFIG.MAX_EMAILS_PER_SWEEP;
  let afterAccountId: string | null = null;
  let emailsSent = 0;
  let accountsProcessed = 0;

  // Pages instead of one take: an account that already got its due email
  // still matches the query for the rest of its catch-up window, so a single
  // oldest-first page could be all already-served rows while newer trials
  // (waiting for the welcome) never made it in. The send cap still bounds
  // one sweep; the page cap bounds the scan.
  for (let page = 0; page < EMAIL_SWEEP_TUNING.MAX_SWEEP_PAGES; page += 1) {
    const accounts = await queryTrialAccounts(now, afterAccountId);
    if (accounts.length === 0) {
      return { emailsSent, accountsProcessed };
    }

    const context = await buildTrialSweepContext(accounts);
    const perAccountSent = await runWithConcurrency(
      accounts,
      EMAIL_LIFECYCLE_CONFIG.SWEEP_CONCURRENCY,
      account => processTrialAccount(account, context)
    );
    emailsSent += perAccountSent.reduce((sum, count) => sum + count, 0);
    accountsProcessed += accounts.length;

    const lastAccount = accounts[accounts.length - 1];
    if (accounts.length < pageSize || lastAccount === undefined) {
      return { emailsSent, accountsProcessed };
    }
    if (emailsSent >= pageSize) {
      break;
    }
    afterAccountId = lastAccount.account_id;
  }

  // Cap-hit observability, parity with the other sweeps: the trial sequence
  // is the main conversion funnel, so a sweep that stopped before the end of
  // the due audience must be visible. The rest waits for the next sweep.
  reportIssueBackend({
    namespace: 'TRIAL_EMAIL_SWEEP_CAP_HIT',
    message: `Trial-email sweep stopped at ${emailsSent} sent / ${accountsProcessed} accounts scanned (caps: ${pageSize} sends, ${EMAIL_SWEEP_TUNING.MAX_SWEEP_PAGES} pages); the rest is deferred to the next sweep`,
    payload: {},
    mode: 'warn',
  });
  return { emailsSent, accountsProcessed };
};
