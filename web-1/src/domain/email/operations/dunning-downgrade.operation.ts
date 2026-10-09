/**
 * Dunning Auto-Downgrade Operation
 *
 * Batch operation: find accounts with payment_status = IN_PROGRESS where the earliest
 * invoice.payment_failed event of the CURRENT dunning cycle (= after the last
 * invoice.payment_succeeded) is > DUNNING_AUTO_DOWNGRADE_DAY days ago,
 * and downgrade them to FREE.
 *
 * Data is NOT deleted — only hidden behind Free plan limits (existing enforcement).
 *
 * DECISION (nie usuwaj tego komentarza):
 * Ten sweep NIE stoi w kontrze do decyzji foundera 2026-06-10 (DOMAIN_SSOT §18:
 * "po odpięciu karty soft-block + JAWNY wybór usera, nigdy auto-downgrade").
 * Tamta decyzja jest jawnie zawężona ("w tym miejscu user musi świadomie
 * zdecydować") do flow DOBROWOLNEGO odpięcia karty w trakcie trialu — wdrożenie
 * soft-blocka = PLAN_LAUNCH_RUNWAY §6.1 (gated: Stripe live). Ten sweep
 * implementuje INNY, osobno zaprojektowany flow: dunning po MIMOWOLNIE nieudanej
 * płatności przy podpiętej karcie (EMAIL_LIFECYCLE.md §2.3 — "Final outcome
 * (Day 15): Downgrade do Free (NIE hard block)"), poprzedzony mailami ostrzegawczymi
 * D1/D7/D14 (DUNNING_EMAIL_SCHEDULE) — downgrade nie jest "cichy". Auto-FREE na
 * terminalu dunningu jest zresztą wpisane w cały model entitlement:
 * subscription-deleted.handler oraz ENTITLEMENT-ACTIVE GATE
 * (subscription-lifecycle.handler) też piszą FREE po wyczerpaniu dunningu Stripe.
 * Rola sweepa = BACKSTOP: (a) zgubione/niedoręczone webhooki, (b) final action
 * dunningu Stripe inne niż "cancel subscription" (uncollectible / leave-as-is =>
 * subskrypcja wisi w past_due, a past_due-grace trzymałaby płatny plan bez końca).
 * Przy defaultowym Stripe (Smart Retries ~2 tyg. + cancel) webhook wygrywa wyścig
 * i sweep jest no-opem (po deleted payment_status=UNPAID ≠ IN_PROGRESS).
 * NIE wyłączać tego sweepa z powołaniem na DOMAIN_SSOT §18 — to nie ten flow.
 */

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  DUNNING_AUTO_DOWNGRADE_DAY,
  EMAIL_LIFECYCLE_CONFIG,
} from '@kernel/domain/email/email-schedule.config';
import { TIME } from '@kernel/application/constants.config';
import {
  AccountStatusValue,
  EventLogTypeValue,
  PaymentStatusValue,
  SubscriptionStatusValue,
} from '@kernel/models/db_models.generated.dto';
import { DB_CLIENT } from '@app/db/db.client';
import { updateAccountPlanStatus } from '@app/stripe/plan-status-update.operations';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { runWithConcurrency } from '@app/utils/concurrency.utils';

const MS_PER_DAY = TIME.MS_PER_DAY;

/**
 * Check for and downgrade accounts that have been in payment limbo > 15 days.
 *
 * Strategy: Query accounts with IN_PROGRESS payment status, then check EventLog
 * for the earliest STRIPE_INVOICE_PAYMENT_FAILED event of the CURRENT dunning
 * cycle (fenced by the last STRIPE_INVOICE_PAYMENT_SUCCEEDED). If > 15 days ago,
 * downgrade.
 *
 * @returns Number of accounts downgraded
 */
export const checkAndDowngradeOverdueAccounts_IO =
  async (): Promise<number> => {
    const cutoffDate = new Date(
      Date.now() - DUNNING_AUTO_DOWNGRADE_DAY * MS_PER_DAY
    );

    // 1. Find accounts with IN_PROGRESS payment (means Stripe is still retrying)
    let overdueAccounts;
    try {
      overdueAccounts = await DB_CLIENT.use.stylistAccount.findMany({
        where: {
          payment_status: PaymentStatusValue.IN_PROGRESS,
          created_by_user: { is_active: true },
        },
        select: {
          account_id: true,
          pricing_plan: true,
          account_status: true,
          subscription_status: true,
          subscription_id: true,
          cancel_at_period_end: true,
          cancel_at: true,
          current_period_end: true,
          created_by_user_id: true,
        },
        // DECISION (nie usuwaj tego komentarza):
        // orderBy current_period_end asc + SSOT cap (MAX_EMAILS_PER_SWEEP, nie literał 50) +
        // cap-hit warn — parytet z winback/renewal/onboarding (I3). Bez orderBy LIMIT zwracał
        // niedeterministyczny podzbiór zaległych kont. Inaczej niż okna onboarding/renewal
        // przepełnienie NIE gubi konta na zawsze (payment_status IN_PROGRESS trwa wiele
        // sweepów, aż downgrade albo Stripe rozwiąże), ale asc = najstarsze current_period_end
        // (najdłużej zalegające, najbliżej terminu downgrade) obsługiwane pierwsze, więc
        // przepełnienie opóźnia najmniej-pilne, nie najbardziej. Warn = obserwability skali.
        orderBy: { current_period_end: 'asc' },
        take: EMAIL_LIFECYCLE_CONFIG.MAX_EMAILS_PER_SWEEP, // Safety cap — batch limit
      });
    } catch (error) {
      reportIssueBackend({
        namespace: 'DUNNING_AUTO_DOWNGRADE_DB_ERROR',
        message: 'Failed to fetch overdue accounts',
        payload: error,
        mode: 'error',
      });
      return 0;
    }

    if (overdueAccounts.length === 0) {
      return 0;
    }

    if (
      overdueAccounts.length === EMAIL_LIFECYCLE_CONFIG.MAX_EMAILS_PER_SWEEP
    ) {
      reportIssueBackend({
        namespace: 'DUNNING_AUTO_DOWNGRADE_SWEEP_CAP_HIT',
        message: `Dunning auto-downgrade sweep hit the per-sweep cap (${EMAIL_LIFECYCLE_CONFIG.MAX_EMAILS_PER_SWEEP}); overdue accounts beyond the cap are deferred to the next sweep`,
        payload: {},
        mode: 'warn',
      });
    }

    // 2a. Fence: last successful payment per user — the CURRENT dunning cycle
    // starts strictly after it.
    //
    // DECISION (nie usuwaj tego komentarza):
    // Bez tego fence'a _min(payment_failed) i dedup EMAIL_DUNNING_AUTO_DOWNGRADE
    // rozciągały się na CAŁĄ historię: klientka, która wyszła z dawnego dunningu
    // (płatność odzyskana) i któremu płatność nie powiodła się ponownie miesiące
    // później, spełniała cutoff >15d NATYCHMIAST (downgrade na najbliższym sweepie,
    // zero karencji), a raz zapisany event downgrade'u wyłączał sweep dla usera NA
    // ZAWSZE. Ta sama klasa buga co permanentny dedup maili dunningowych naprawiony
    // w invoice.handler.ts (fence period_start). Tu fencem jest ostatni
    // STRIPE_INVOICE_PAYMENT_SUCCEEDED (brak = cała historia to jeden cykl —
    // np. pierwsza płatność po trialu).
    const userIds = overdueAccounts.map(a => a.created_by_user_id);
    let lastSuccessGroups;
    try {
      lastSuccessGroups = await DB_CLIENT.use.eventLog.groupBy({
        by: ['created_by_user_id'],
        where: {
          event: APP_EVENTS.INFO.ACCOUNT.STRIPE_INVOICE_PAYMENT_SUCCEEDED,
          event_type: EventLogTypeValue.ACCOUNT,
          created_by_user_id: { in: userIds },
        },
        _max: { created_at: true },
      });
    } catch (error) {
      reportIssueBackend({
        namespace: 'DUNNING_AUTO_DOWNGRADE_DB_ERROR',
        message: 'Failed to fetch last-success fence events',
        payload: error,
        mode: 'error',
      });
      return 0;
    }

    const lastSuccessMap = new Map<string, Date>();
    for (const group of lastSuccessGroups) {
      if (group._max.created_at) {
        lastSuccessMap.set(group.created_by_user_id, group._max.created_at);
      }
    }

    // Per-user scope: only events belonging to the current dunning cycle.
    const currentCycleScope = userIds.map(uid => {
      const fence = lastSuccessMap.get(uid);
      return {
        created_by_user_id: uid,
        ...(fence ? { created_at: { gt: fence } } : {}),
      };
    });

    // 2b. Current-cycle events: earliest payment_failed (grace clock) + dedup.
    // C-perf-24 zachowane w duchu: fence ogranicza fetch do zdarzeń bieżącego
    // cyklu (Stripe Smart Retries = max ~8 failed/user/cykl), bez over-fetchu
    // całej historii. orderBy asc + cap: przy (nierealnym) przepełnieniu gubimy
    // NAJPÓŹNIEJSZE wiersze, więc per-user minimum pozostaje poprawne albo user
    // wypada z tej rundy sweepa (kierunek bezpieczny — brak downgrade'u).
    let failedEvents;
    let downgradeEvents;
    try {
      [failedEvents, downgradeEvents] = await Promise.all([
        DB_CLIENT.use.eventLog.findMany({
          where: {
            event: APP_EVENTS.INFO.ACCOUNT.STRIPE_INVOICE_PAYMENT_FAILED,
            event_type: EventLogTypeValue.ACCOUNT,
            OR: currentCycleScope,
          },
          select: { created_by_user_id: true, created_at: true },
          orderBy: { created_at: 'asc' },
          take: EMAIL_LIFECYCLE_CONFIG.MAX_EMAILS_PER_SWEEP * 20,
        }),
        DB_CLIENT.use.eventLog.findMany({
          where: {
            event: APP_EVENTS.INFO.EMAIL.EMAIL_DUNNING_AUTO_DOWNGRADE,
            event_type: EventLogTypeValue.EMAIL,
            OR: currentCycleScope,
          },
          select: { created_by_user_id: true },
          take: userIds.length,
        }),
      ]);
    } catch (error) {
      reportIssueBackend({
        namespace: 'DUNNING_AUTO_DOWNGRADE_DB_ERROR',
        message: 'Failed to fetch event logs',
        payload: error,
        mode: 'error',
      });
      return 0;
    }

    // Build map: userId -> earliest payment_failed date (current cycle only)
    const earliestFailedMap = new Map<string, Date>();
    for (const event of failedEvents) {
      const previous = earliestFailedMap.get(event.created_by_user_id);
      if (!previous || event.created_at < previous) {
        earliestFailedMap.set(event.created_by_user_id, event.created_at);
      }
    }

    const alreadyDowngraded = new Set(
      downgradeEvents.map(e => e.created_by_user_id)
    );

    // 4. Process accounts with bounded concurrency (5 parallel).
    //    Worker MUST swallow errors so pool doesn't reject mid-batch.
    const downgradeResults = await runWithConcurrency(
      overdueAccounts,
      5,
      async account => {
        try {
          const userId = account.created_by_user_id;

          // Skip if already processed
          if (alreadyDowngraded.has(userId)) {
            return 0;
          }

          // Skip if no payment_failed event found
          const earliestFailed = earliestFailedMap.get(userId);
          if (!earliestFailed) {
            return 0;
          }

          // Skip if not yet past the cutoff
          if (earliestFailed > cutoffDate) {
            return 0;
          }

          // Downgrade to FREE
          // DECISION (nie usuwaj tego komentarza): spadek do Free (dunning/sync) = ACTIVE, nie NOT_ACTIVE — darmowe konto pozostaje widoczne w discovery, spójnie z subscription-deleted.handler.ts i ścieżkami tworzenia konta. Dane nie są usuwane, tylko ograniczone limitami Free.
          await updateAccountPlanStatus({
            accountId: account.account_id,
            pricingPlan: PricingPlanValue.FREE,
            paymentStatus: PaymentStatusValue.UNPAID,
            accountStatus: AccountStatusValue.ACTIVE,
            subscriptionStatus: SubscriptionStatusValue.CANCELED,
            subscriptionId: account.subscription_id,
            cancelAtPeriodEnd: false,
            cancelAt: null,
            currentPeriodEnd: null,
            oldPricingPlan: account.pricing_plan,
            source: 'stripe',
            createdByUserId: userId,
          });

          // EventLog for tracking
          await recordAuditEvent_IO({
            eventName: APP_EVENTS.INFO.EMAIL.EMAIL_DUNNING_AUTO_DOWNGRADE,
            user: { id: userId },
            responseBody: {
              accountId: account.account_id,
              previousPlan: account.pricing_plan,
              daysSinceFirstFailure: Math.floor(
                (Date.now() - earliestFailed.getTime()) / MS_PER_DAY
              ),
            },
          });

          reportIssueBackend({
            namespace: 'DUNNING_AUTO_DOWNGRADE',
            message: `Account ${account.account_id} auto-downgraded to FREE after ${DUNNING_AUTO_DOWNGRADE_DAY} days`,
            payload: { accountId: account.account_id, userId },
            mode: 'info',
          });

          return 1;
        } catch (error) {
          // Error isolation — one account failure doesn't block others
          reportIssueBackend({
            namespace: 'DUNNING_AUTO_DOWNGRADE_ERROR',
            message: `Failed to auto-downgrade account ${account.account_id}`,
            payload: error,
            mode: 'error',
          });
          return 0;
        }
      }
    );

    return downgradeResults.reduce<number>((sum, n) => sum + n, 0);
  };
