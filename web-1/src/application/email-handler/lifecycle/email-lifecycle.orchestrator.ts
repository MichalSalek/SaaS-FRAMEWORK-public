// DECISION (nie usuwaj tego komentarza):
// Sweep odpalany przez request interceptor (NIE external cron). Świadoma decyzja
// Korekta 2026-07-19: uptime monitor jest DB-free i NIE jest traffic floorem.
// Sweep planuje się dopiero po zaakceptowanym ruchu aplikacji, gdy DB już była potrzebna.
// Monitoring: "last sweep at" w admin /health; >48h = sygnał do oceny external crona.

/**
 * Email Lifecycle Interceptor — Sweep Orchestrator
 *
 * Runs as fire-and-forget from HTTP middleware (same pattern as pairingCleanupInterceptor).
 *
 * Thin dispatcher: each sweep step lives in its own module/operation. The orchestrator
 * only wires the steps together (trial-email phase + safeStep'd domain operations),
 * aggregates counts, and logs completion.
 *
 * Key guarantees:
 * - In-memory 6h throttle per instance (emailLifecycleInterceptor)
 * - Quiet hours (21:00-09:00 UTC) respected
 * - EventLog dedup prevents duplicate emails across instances (per-step)
 * - N+1 prevention: batch fetch inside each phase/operation
 * - Error isolation: one failed step doesn't block the sweep (safeStep)
 */

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { resolveSystemActorId_IO } from '@app/event-log/system-actor';
import {
  shouldRunEmailSweep,
  isEmailQuietHours,
  tryBeginEmailSweep,
  endEmailSweep,
  updateLastSweepTimestamp,
} from '@app/email-handler/email-lifecycle.state';
import { withSweepTiming } from '@app/health/sweep-monitoring.utils';
import { ENV_VARS } from '@app/environment/environment.config';
import { checkAndDowngradeOverdueAccounts_IO } from '@domain/email/operations/dunning-downgrade.operation';
import { sendDailySignupDigest_IO } from '@domain/email/operations/admin-alerts.operation';
import { sendOnboardingAbandonmentEmails_IO } from '@domain/email/operations/onboarding-abandonment.operation';
import { sendRenewalReminderEmails_IO } from '@domain/email/operations/renewal-reminder.operation';
import { sendCancelSequenceEmails_IO } from '@domain/email/operations/cancel-sequence.operation';
import { sendWinbackDeletionEmails_IO } from '@domain/email/operations/winback-deletion.operation';
import { sweepExpiringAndExpiredAccounts_IO } from '@domain/account/operations/account-expiry-sweep.operation';
import { runAnomalyChecks_IO } from '@app/monitoring/anomaly-alerts.operation';
import { sendTrialEmails_IO } from '@domain/email/operations/trial-emails.operation';

/** Error-isolated sweep step — logs failure but doesn't block the sweep. */
async function safeStep<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T | 0> {
  try {
    return await fn();
  } catch (error) {
    reportIssueBackend({
      namespace: 'EMAIL_LIFECYCLE_SWEEP',
      message: `${label} failed (non-blocking)`,
      payload: error,
      mode: 'error',
    });
    return 0;
  }
}

/**
 * Main sweep logic — called only when throttle + quiet hours check passes.
 * Dispatches each step; aggregates counts; logs completion.
 */
const runSweep = async (): Promise<void> => {
  // 0. Pre-check in production only (dev/staging use deterministic fallback
  // in email-unsubscribe.token). Fail once, not N times per account.
  const isProd = ENV_VARS.NODE_ENV_MANUAL === 'PRODUCTION';
  if (isProd && !ENV_VARS.EMAIL_UNSUBSCRIBE_SECRET) {
    reportIssueBackend({
      namespace: 'EMAIL_LIFECYCLE_SWEEP',
      message: 'Sweep aborted: EMAIL_UNSUBSCRIBE_SECRET is not configured',
      payload: {},
      mode: 'error',
    });
    return;
  }

  // 1. Trial-email sweep phase (query trial accounts → send due trial emails)
  const { emailsSent, accountsProcessed } = await sendTrialEmails_IO();

  // DECISION (nie usuwaj tego komentarza, 2026-09-23):
  // Wczesny return przy accountsProcessed === 0 (BDX W4.2, „zachowaj pre-split")
  // jest skasowany. Sweep zapisywał wyłącznie EMAIL_WELCOME_SENT: zapytanie trialu
  // wymagało payment_status != PAID, a trial
  // Stripe z kartą mapuje trialing → PAID, więc accountsProcessed było zawsze 0
  // i dunning, expiry, onboarding, renewal, win-back D60, digest i anomaly nigdy
  // nie biegły. Kroki są niezależne od trialu i każdy siedzi w safeStep. Właściciel
  // 2026-09-22 („dopracuj emaile"): każdy sweep wykonuje wszystkie kroki, także przy
  // zerze kont trialowych. Cisza nocna, cap tygodniowy, MAX per sweep i guard
  // EMAIL_UNSUBSCRIBE_SECRET zostają.

  // 2. Dunning auto-downgrade check (after trial emails, before logging)
  const downgradedCount = await safeStep(
    'Dunning auto-downgrade check',
    checkAndDowngradeOverdueAccounts_IO
  );

  // 2a. Account-status expiry sweep (BUG-001 — replaces per-request interceptor write-on-read).
  //     EXPIRING/EXPIRED driven by Stripe current_period_end, off the request path.
  await safeStep('Account expiry sweep', sweepExpiringAndExpiredAccounts_IO);

  // 2b. Onboarding abandonment recovery (24h after signup, no StylistAccount)
  const onboardingAbandonmentSent = await safeStep(
    'Onboarding abandonment recovery',
    sendOnboardingAbandonmentEmails_IO
  );

  // 2c. Pre-renewal nudge (7 days before subscription renewal)
  const renewalReminderSent = await safeStep(
    'Pre-renewal nudge',
    sendRenewalReminderEmails_IO
  );

  const cancelSequenceSent = await safeStep(
    'Cancel sequence',
    sendCancelSequenceEmails_IO
  );

  // 2d. Win-back D60 — soft-deleted accounts still in 90d recovery window
  const winbackDeletionSent = await safeStep(
    'Win-back deletion D60',
    sendWinbackDeletionEmails_IO
  );

  // 3. Admin daily signup digest (fire-and-forget — OK for admin alerts)
  await safeStep('Admin signup digest', sendDailySignupDigest_IO);

  // 4. Anomaly alerts (fire-and-forget — own dedup via EventLog, max 1/day/type)
  await safeStep('Anomaly checks', runAnomalyChecks_IO);

  const totalEmailsSent =
    emailsSent +
    (typeof onboardingAbandonmentSent === 'number'
      ? onboardingAbandonmentSent
      : 0) +
    (typeof renewalReminderSent === 'number' ? renewalReminderSent : 0) +
    (typeof cancelSequenceSent === 'number' ? cancelSequenceSent : 0) +
    (typeof winbackDeletionSent === 'number' ? winbackDeletionSent : 0);

  // 5. Log sweep completion.
  // DECISION (nie usuwaj tego komentarza, 2026-09-23):
  // Recorded on EVERY sweep, also an empty one. The sweep runs on accepted
  // API traffic, `info` logs are not persisted in production and the in-memory
  // sweep monitor resets on every deploy, so this row is the only durable
  // evidence of how often mail can go out at all. At most ~4 rows a day,
  // logged under the system actor and excluded from per-user email history
  // (EMAIL_HISTORY_CONTROL_EVENTS).
  // L1 r28: explicit .catch() — defensive guard if recordAuditEvent_IO ever
  // stops swallowing errors internally, prevent unhandled rejection here.
  const systemActorId = await resolveSystemActorId_IO();
  void recordAuditEvent_IO({
    eventName: APP_EVENTS.INFO.EMAIL.EMAIL_SWEEP_COMPLETED,
    user: systemActorId ? { id: systemActorId } : null,
    responseBody: {
      emailsSent: totalEmailsSent,
      trialEmailsSent: emailsSent,
      onboardingAbandonmentSent: onboardingAbandonmentSent || 0,
      renewalReminderSent: renewalReminderSent || 0,
      cancelSequenceSent: cancelSequenceSent || 0,
      winbackDeletionSent: winbackDeletionSent || 0,
      accountsProcessed,
      downgradedCount,
    },
  }).catch(() => undefined);

  reportIssueBackend({
    namespace: 'EMAIL_LIFECYCLE_SWEEP',
    message: `Sweep completed: ${totalEmailsSent} emails sent (trial:${emailsSent} onboarding:${onboardingAbandonmentSent || 0} renewal:${renewalReminderSent || 0} cancel:${cancelSequenceSent || 0} winback:${winbackDeletionSent || 0}) for ${accountsProcessed} accounts, ${downgradedCount} auto-downgraded`,
    payload: {
      totalEmailsSent,
      trialEmailsSent: emailsSent,
      onboardingAbandonmentSent: onboardingAbandonmentSent || 0,
      renewalReminderSent: renewalReminderSent || 0,
      cancelSequenceSent: cancelSequenceSent || 0,
      winbackDeletionSent: winbackDeletionSent || 0,
      accountsProcessed,
      downgradedCount,
    },
    mode: 'info',
  });
};

/**
 * Email Lifecycle Interceptor
 *
 * Fire-and-forget, scheduled from scheduleMaintenanceSweeps (request.middleware.ts).
 *
 * DECISION (nie usuwaj tego komentarza):
 * Ten sweep NIE idzie przez `createSweepInterceptor` i nie jest to zaniedbanie —
 * to udokumentowany wyjątek (allowlist w `tests/audit/sweep-interceptor.sh`, który
 * od teraz odkrywa sweepy po TREŚCI, nie po nazwie pliku, więc ten plik JEST przez
 * niego mierzony). Fabryka stempluje throttle PRZED `await run()` i bezwarunkowo
 * („mark-before-await" = per-instance dedup na napływ równoległych requestów).
 * Tu stempel jest celowo PÓŹNIEJ i warunkowo, w dwóch niezależnych miejscach:
 *
 *   1. CISZA NOCNA (quiet hours, 21:00-09:00 UTC) sprawdzana PO bramce throttle, ale PRZED
 *      dotknięciem znacznika — request wpadający w ciszę NIE zjada okna 6h. Gdyby
 *      quiet-hours zjechały do `run`, fabryka miałaby już ostemplowane: request
 *      o 08:55 UTC przesuwałby dzienny sweep mailowy na ~14:55.
 *   2. `updateLastSweepTimestamp()` woła się WYŁĄCZNIE po UDANYM sweepie —
 *      nieudany ma się powtórzyć przy następnym kwalifikującym się requeście,
 *      a nie czekać pełne 6h (maile transakcyjne cyklu życia = ruch pieniężny:
 *      dunning, przypomnienie o odnowieniu, digest).
 *
 * Napływ równoległy (dwa requesty naraz przed zapisaniem stempla) zamyka flaga
 * „sweep w toku" (`tryBeginEmailSweep`, S122): dedup EventLog per-krok to odczyt
 * → wysyłka → zapis, NIE operacja atomowa, więc sam nie chronił przed duplikatem
 * maila przy dwóch równoległych sweepach. Migracja na fabrykę = zmiana czasu dostarczania
 * maili i semantyki retry, NIE refaktor szkieletu. Wróć do tematu dopiero, gdy
 * fabryka dostanie jawny seam na politykę stemplowania (`markPolicy`).
 */
export const emailLifecycleInterceptor = async (): Promise<void> => {
  // 1. Throttle check (6h)
  if (!shouldRunEmailSweep()) {
    return;
  }

  // 2. Quiet hours check (21:00-09:00 UTC)
  if (isEmailQuietHours()) {
    return;
  }

  // 3. One sweep at a time (see the DECISION above).
  if (!tryBeginEmailSweep()) {
    return;
  }

  try {
    await withSweepTiming('email-lifecycle', runSweep);
    // Only mark as run AFTER successful sweep — failed sweep should retry on next trigger
    updateLastSweepTimestamp();
  } catch (error) {
    reportIssueBackend({
      namespace: 'EMAIL_LIFECYCLE_INTERCEPTOR',
      message: 'Email lifecycle sweep failed',
      payload: error,
      mode: 'error',
    });
    // Don't throw — sweep failure shouldn't block requests
    // Timestamp NOT updated — sweep retries on next eligible request
  } finally {
    endEmailSweep();
  }
};
