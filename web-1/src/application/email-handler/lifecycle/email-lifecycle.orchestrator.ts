import { randomUUID } from 'node:crypto';
import { sendFreeEmails_IO } from '@domain/email/operations/free-email.operation';
import {
  exportLifecycleOperations,
  operationalExportFailureMode,
} from './operational-export';
import { retainLifecycleDetails } from './retention';
import { reconcileStaleLifecycleMessages_IO } from './ledger-reconciliation';
// DECISION: see web-1/src/application/scheduler/scheduled-jobs.registry.ts (what starts the periodic
// jobs: the external tick, with accepted API traffic as a secondary trigger through the same lease).
// Monitoring: `sweeps` in admin /health and the EMAIL_SWEEP_COMPLETED row of every sweep.

/**
 * Email Lifecycle Job — Sweep Orchestrator
 *
 * Thin dispatcher: each sweep step lives in its own module/operation. The orchestrator
 * only wires the steps together (trial-email phase + safeStep'd domain operations),
 * aggregates counts, and logs completion.
 *
 * Key guarantees:
 * - Due every 6 h, one sweep at a time across processes (scheduler lease, JobLease)
 * - Quiet hours (21:00-09:00 UTC) respected: a due sweep is not even claimed in them
 * - A failed sweep is retried after SCHEDULER_CONFIG.FAILURE_RETRY_MS, not after 6 h
 * - Per-message ledger reservation prevents duplicate emails if a body outlives its lease
 * - N+1 prevention: batch fetch inside each phase/operation
 * - Error isolation: one failed step doesn't block the sweep (safeStep)
 */

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { resolveSystemActorId_IO } from '@app/event-log/system-actor';
import { isEmailQuietHours } from '@app/email-handler/email-lifecycle.state';
import { defineScheduledJob } from '@app/scheduler/scheduled-job';
import { JobLeaseLostError } from '@app/scheduler/job-runner';
import { EMAIL_LIFECYCLE_CONFIG } from '@kernel/domain/email/email-schedule.config';
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
  fn: () => Promise<T>,
  signal?: AbortSignal
): Promise<T | 0> {
  // A lost lease stops the sweep between steps (the next owner runs it again from the start;
  // every send is reserved in the ledger, so nothing already sent is repeated).
  if (signal?.aborted) {
    throw new JobLeaseLostError('email-lifecycle');
  }
  try {
    return await fn();
  } catch (error) {
    reportIssueBackend({
      namespace: 'EMAIL_LIFECYCLE_SWEEP',
      message: `${label} failed (non-blocking)`,
      payload: error,
      mode: operationalExportFailureMode(error),
    });
    return 0;
  }
}

/**
 * Main sweep logic — called only when throttle + quiet hours check passes.
 * Dispatches each step; aggregates counts; logs completion.
 */
const runSweep = async (signal?: AbortSignal): Promise<void> => {
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

  const sweepId = randomUUID();
  await safeStep(
    'Lifecycle interrupted sends',
    reconcileStaleLifecycleMessages_IO,
    signal
  );

  // 1. Trial-email sweep phase (query trial accounts → send due trial emails)
  const { emailsSent, accountsProcessed } = await sendTrialEmails_IO(sweepId);

  // DECISION: no early return on accountsProcessed === 0. Dunning, expiry, onboarding, renewal,
  // win-back D60, digest and anomaly steps are independent of trial accounts (each sits in
  // safeStep), and an early return silenced all of them. Quiet hours, the weekly cap, the
  // per-sweep MAX and the EMAIL_UNSUBSCRIBE_SECRET guard stay. (owner)

  // 2. Dunning auto-downgrade check (after trial emails, before logging)
  const downgradedCount = await safeStep(
    'Dunning auto-downgrade check',
    checkAndDowngradeOverdueAccounts_IO,
    signal
  );

  // 2a. Account-status expiry sweep (BUG-001 — replaces per-request interceptor write-on-read).
  //     EXPIRING/EXPIRED driven by Stripe current_period_end, off the request path.
  await safeStep(
    'Account expiry sweep',
    sweepExpiringAndExpiredAccounts_IO,
    signal
  );

  // 2b. Onboarding abandonment recovery (24h after signup, no StylistAccount)
  const onboardingAbandonmentSent = await safeStep(
    'Onboarding abandonment recovery',
    () => sendOnboardingAbandonmentEmails_IO(sweepId),
    signal
  );

  // 2c. Pre-renewal nudge (7 days before subscription renewal)
  const renewalReminderSent = await safeStep(
    'Pre-renewal nudge',
    sendRenewalReminderEmails_IO,
    signal
  );

  const cancelSequenceSent = await safeStep(
    'Cancel sequence',
    () => sendCancelSequenceEmails_IO(sweepId),
    signal
  );

  // 2d. Win-back D60 — soft-deleted accounts still in 90d recovery window
  const winbackDeletionSent = await safeStep(
    'Win-back deletion D60',
    () => sendWinbackDeletionEmails_IO(sweepId),
    signal
  );

  const freeResult = await safeStep(
    'Free onboarding',
    () => sendFreeEmails_IO(sweepId),
    signal
  );
  const freeEmailsSent =
    typeof freeResult === 'number' ? 0 : freeResult.emailsSent;
  await safeStep(
    'Lifecycle operational export',
    exportLifecycleOperations,
    signal
  );
  await safeStep('Lifecycle detail retention', retainLifecycleDetails, signal);

  // 3. Admin daily signup digest (fire-and-forget — OK for admin alerts)
  await safeStep('Admin signup digest', sendDailySignupDigest_IO, signal);

  // 4. Anomaly alerts (fire-and-forget — own dedup via EventLog, max 1/day/type)
  await safeStep('Anomaly checks', runAnomalyChecks_IO, signal);

  const totalEmailsSent =
    emailsSent +
    freeEmailsSent +
    (typeof onboardingAbandonmentSent === 'number'
      ? onboardingAbandonmentSent
      : 0) +
    (typeof renewalReminderSent === 'number' ? renewalReminderSent : 0) +
    (typeof cancelSequenceSent === 'number' ? cancelSequenceSent : 0) +
    (typeof winbackDeletionSent === 'number' ? winbackDeletionSent : 0);

  // 5. Log sweep completion.
  // DECISION: recorded on EVERY sweep, also an empty one. `info` logs are not persisted in
  // production and the in-memory sweep monitor resets on deploy, so this row is the only durable
  // evidence of how often mail can go out. About 4 rows a day, under the system actor, excluded
  // from per-user email history (EMAIL_HISTORY_CONTROL_EVENTS).
  // L1 r28: explicit .catch() — defensive guard if recordAuditEvent_IO ever
  // stops swallowing errors internally, prevent unhandled rejection here.
  const systemActorId = await resolveSystemActorId_IO();
  void recordAuditEvent_IO({
    eventName: APP_EVENTS.INFO.EMAIL.EMAIL_SWEEP_COMPLETED,
    user: systemActorId ? { id: systemActorId } : null,
    responseBody: {
      emailsSent: totalEmailsSent,
      trialEmailsSent: emailsSent,
      freeEmailsSent,
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
      freeEmailsSent,
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

export const emailLifecycleJob = defineScheduledJob({
  name: 'email-lifecycle',
  wakesOnTick: true,
  intervalMs: EMAIL_LIFECYCLE_CONFIG.SWEEP_THROTTLE_MS,
  canRunAt: now => !isEmailQuietHours(now),
  run: ({ signal }) => runSweep(signal),
});
