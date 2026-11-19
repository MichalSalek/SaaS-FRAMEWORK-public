// DECISION: see web-1/src/application/scheduler/scheduled-jobs.registry.ts (what starts the periodic
// jobs). Without this job expireStaleSessionContainers ran only at startup (instrumentation.ts, kept as
// warm-up), and on long-running Render no session created after boot ever became EXPIRED in the DB.

// DECISION: 6h interval (vs 24h for pairing/event-log cleanup). An unswept expired session keeps
// occupying a stylist quota slot (the read side filters expires_at, the count was the gap), so 6h
// bounds the worst-case slot squat. Sweep cost on a synced state is one indexed updateMany
// matching 0 rows.

/**
 * SESSION CONTAINER EXPIRY JOB
 *
 * Due every 6 h. Transitions SHARED/ACTIVE sessions past expires_at to EXPIRED and sends the
 * one 3-days-before reminder to both sides. Cross-process exclusion is the scheduler's durable
 * lease (JobLease), not a session-level advisory lock (dropped: its unlock could miss on a pooled
 * backend). A repeated update matches 0 rows and access correctness does not depend on it (the
 * read side filters expires_at directly).
 */

import { TIME } from '@kernel/application/constants.config';
import { defineScheduledJob } from '@app/scheduler/scheduled-job';
import { expireStaleSessionContainers } from '@domain/session-container/session-container.expire-sweep';
import { sendSessionExpiryReminders } from '@domain/session-container/session-container.expiry-reminder';

export const sessionContainerExpiryJob = defineScheduledJob({
  name: 'session-container-expiry',
  wakesOnTick: true,
  intervalMs: 6 * TIME.MS_PER_HOUR,
  // Reports its own count; rethrows after reporting so a failed sweep is a failed run.
  run: async () => {
    await expireStaleSessionContainers({ rethrow: true });
    await sendSessionExpiryReminders();
  },
});
