import type { JobLeaseStore } from './job-lease.store';

/** What a job body receives. `signal` aborts when the lease is lost (taken over or expired). */
export type JobRunContext = {
  signal: AbortSignal;
};

export type LeasedJob = {
  name: string;
  /** Next due = completion + interval. */
  intervalMs: number;
  /** Lease length; renewed every third of it while the body runs. */
  leaseTtlMs: number;
  run: (context: JobRunContext) => Promise<void>;
};

export type LeasedRunOutcome =
  | { status: 'not-claimed' }
  | {
      status: 'completed' | 'failed';
      durationMs: number;
      error: string | null;
      /** The lease was lost before the result could be written: someone else owns the job now. */
      fenced: boolean;
    };

/** Upper bound of one renewal (server statement timeout and client wait). */
const MAX_RENEW_TIMEOUT_MS = 5_000;

export class JobLeaseLostError extends Error {
  constructor(jobName: string) {
    super(`Lease of job "${jobName}" was lost`);
    this.name = 'JobLeaseLostError';
  }
}

type RunLeasedJobInput = {
  job: LeasedJob;
  store: JobLeaseStore;
  /** Unique per claim (instance id + random): the fencing token. */
  owner: string;
  /** Process identity written on completion (single-instance monitoring). */
  instance: string;
  /** Claim jobs due within this window too (lets one tick serve jobs due a moment later). */
  earlyMs: number;
  /** A failed run is retried after min(interval, this). */
  failureRetryMs: number;
  /** Monotonic clock in ms; injectable for tests. */
  monotonicNow?: () => number;
};

/**
 * Claim, renew, then complete or fail, fenced by the owner token.
 * Test: web-1/tests/postgres/job-lease.test.ts (20 claims, one winner;
 * 3 short workers whose recorded runs do not overlap; SIGKILL blocks only
 * until lease expiry; a stale owner's complete/fail returns false). The
 * cases are those counts. A body that outlives a lost lease keeps running
 * until it next checks signal.
 */
export const runLeasedJob = async ({
  job,
  store,
  owner,
  instance,
  earlyMs,
  failureRetryMs,
  monotonicNow = () => performance.now(),
}: RunLeasedJobInput): Promise<LeasedRunOutcome> => {
  // Taken BEFORE the claim round trip: the database starts the lease at its own `now()`, which is
  // no earlier than this moment, so `claimSentAt + ttl` is a safe lower bound of the lease end on
  // this process's monotonic clock (taking it after the claim would overstate it by the latency).
  const claimSentAt = monotonicNow();
  const claimed = await store.claim(job.name, owner, job.leaseTtlMs, earlyMs);
  if (!claimed) {
    return { status: 'not-claimed' };
  }

  const startedAt = monotonicNow();
  let leaseValidUntil = claimSentAt + job.leaseTtlMs;
  const controller = new AbortController();
  const renewEveryMs = Math.max(1, Math.floor(job.leaseTtlMs / 3));
  const renewTimeoutMs = Math.min(renewEveryMs, MAX_RENEW_TIMEOUT_MS);
  let renewing = false;
  let lastRenewAttemptAt = startedAt;

  const loseLease = (): void => {
    if (!controller.signal.aborted) {
      controller.abort(new JobLeaseLostError(job.name));
    }
  };

  const renewOnce = (): void => {
    renewing = true;
    const attemptAt = monotonicNow();
    lastRenewAttemptAt = attemptAt;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error('lease renewal timed out')),
        renewTimeoutMs
      );
    });
    Promise.race([
      store.renew(job.name, owner, job.leaseTtlMs, renewTimeoutMs),
      timedOut,
    ])
      .then(
        renewed => {
          if (renewed) {
            leaseValidUntil = attemptAt + job.leaseTtlMs;
          } else {
            loseLease();
          }
        },
        () => {
          // A failed or hung renewal is not yet a lost lease; the expiry check below decides.
        }
      )
      .finally(() => {
        clearTimeout(timeout);
        renewing = false;
      });
  };

  // DECISION: the expiry check runs on every timer tick, also while a renewal is still in flight: a
  // renewal stuck on a dead connection must not keep the body running past the lease, when another
  // process may already own the job. Checks run twice per renewal period.
  const renewTimer = setInterval(
    () => {
      if (controller.signal.aborted) {
        return;
      }
      const now = monotonicNow();
      if (now >= leaseValidUntil) {
        loseLease();
        return;
      }
      if (!renewing && now - lastRenewAttemptAt >= renewEveryMs) {
        renewOnce();
      }
    },
    Math.max(1, Math.floor(renewEveryMs / 2))
  );
  if (typeof renewTimer === 'object' && 'unref' in renewTimer) {
    renewTimer.unref();
  }

  const elapsed = (): number => monotonicNow() - startedAt;
  const retryMs = Math.min(job.intervalMs, failureRetryMs);

  try {
    await job.run({ signal: controller.signal });
  } catch (error) {
    clearInterval(renewTimer);
    const message = error instanceof Error ? error.message : String(error);
    const durationMs = elapsed();
    const recorded = await store
      .fail(job.name, owner, retryMs, durationMs, message, instance)
      .catch(() => false);
    return { status: 'failed', durationMs, error: message, fenced: !recorded };
  }

  clearInterval(renewTimer);
  const durationMs = elapsed();
  const recorded = await store
    .complete(job.name, owner, job.intervalMs, durationMs, instance)
    .catch(() => false);
  return { status: 'completed', durationMs, error: null, fenced: !recorded };
};
