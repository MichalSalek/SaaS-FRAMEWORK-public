import { createHash } from 'node:crypto';
import { DB_CLIENT } from '@app/db/db.client';
import { ENV_VARS } from '@app/environment/environment.config';
import { IS_PRODUCTION_ENV } from '@app/environment/environment.utils.api';
import { TIME } from '@kernel/application/constants.config';

const EXPORT_BACKLOG_ERROR_AGE_MS = TIME.MS_PER_DAY;
const EXPORT_FAILURE_NAME = 'LifecycleOperationalExportError';

/** A retryable analytics export is degraded; a full day of pending data needs an error alert. */
export function operationalExportFailureMode(error: unknown): 'warn' | 'error' {
  return typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === EXPORT_FAILURE_NAME &&
    'retryable' in error &&
    error.retryable === true &&
    'pendingAgeMs' in error &&
    typeof error.pendingAgeMs === 'number' &&
    Number.isFinite(error.pendingAgeMs) &&
    error.pendingAgeMs >= 0 &&
    error.pendingAgeMs < EXPORT_BACKLOG_ERROR_AGE_MS
    ? 'warn'
    : 'error';
}

export type OperationalExportRow = {
  id: string;
  messageId: string | null;
  kind: string;
  state: string | null;
  reason: string | null;
  dimensions: unknown;
  occurredAt: Date;
};

const dimension = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[a-zA-Z0-9_:-]{1,100}$/.test(value)
    ? value
    : undefined;

const REASONS = new Set([
  'not_configured',
  'missing_provider_id',
  'provider_error',
  'circuit_open',
  'dev_sink',
  'network_or_timeout',
  'eligibility_changed',
  'render_error',
  'already_started',
  'opportunity_reserved',
  'already_reserved',
  'delivery_suppressed',
  'sweep_budget',
  'weekly_limit',
  'frequency_unavailable',
  'minimum_spacing',
  'quiet_hours',
  'send_interrupted',
  'reservation_expired',
  'preference_disabled',
  'inactive',
  'excluded',
  'unsubscribed',
  'delivery_blocked',
  'access_changed',
  'completed',
  'expired',
  'sent',
  'not_due',
  'window_expired',
  'checkout_active',
  'minimum_gap',
  'step_already_reminded',
  'account_missing',
  'closed',
  'resend_only_retry',
  'recipient_missing',
  'intent_expired',
  'retry_exhausted',
  'unknown_unresolved',
  'dispatch_error',
]);

/** Explicit allowlist: neither the relation, arbitrary provider error text nor addresses leave the DB. */
export function operationalCapture(row: OperationalExportRow) {
  const source =
    typeof row.dimensions === 'object' &&
    row.dimensions !== null &&
    !Array.isArray(row.dimensions)
      ? (row.dimensions as Record<string, unknown>)
      : {};
  const properties: Record<string, string | boolean | number> = {
    distinct_id: 'email-operations',
    $process_person_profile: false,
    lifecycle_operational_id: row.id,
    lifecycle_kind: dimension(row.kind) ?? 'unknown',
    lifecycle_state: dimension(row.state) ?? dimension(row.kind) ?? 'unknown',
    lifecycle_reason:
      row.reason && REASONS.has(row.reason)
        ? row.reason
        : row.reason
          ? 'provider_error'
          : 'none',
  };
  for (const key of ['count', 'active', 'finished', 'completed'] as const) {
    const value = source[key];
    if (
      typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0
    ) {
      properties[`lifecycle_${key}`] = value;
    }
  }
  if (row.messageId) {
    properties.lifecycle_message_id = row.messageId;
  }
  for (const [target, key] of [
    ['family', 'family'],
    ['rule', 'ruleId'],
    ['template', 'templateId'],
    ['locale', 'locale'],
    ['cohort', 'cohort'],
    ['transport', 'transport'],
  ] as const) {
    properties[`lifecycle_${target}`] = dimension(source[key]) ?? 'unknown';
  }
  const hash = createHash('sha256')
    .update(`nf-lifecycle:${row.id}`)
    .digest('hex');
  const uuid = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  return {
    uuid,
    event: 'email_lifecycle_operational',
    timestamp: row.occurredAt.toISOString(),
    properties,
  };
}

/** Cohort totals are grouped operational counters, without recipient-level behavioral re-emission. */
async function enqueueCohortSnapshot(now = new Date()): Promise<void> {
  const bucket = new Date(
    Math.floor(now.getTime() / (6 * 3600000)) * 6 * 3600000
  );
  const groups = await DB_CLIENT.use.freeEmailEnrollment.groupBy({
    by: ['cohort', 'status', 'finishReason'],
    _count: { _all: true },
    orderBy: [{ cohort: 'asc' }, { status: 'asc' }, { finishReason: 'asc' }],
    take: 100,
  });
  const summaries = ['new', 'existing'].map(cohort => {
    const own = groups.filter(group => group.cohort === cohort);
    return {
      cohort,
      family: 'free',
      count: own.reduce((sum, group) => sum + group._count._all, 0),
      active: own
        .filter(group => group.status === 'active')
        .reduce((sum, group) => sum + group._count._all, 0),
      finished: own
        .filter(group => group.status === 'finished')
        .reduce((sum, group) => sum + group._count._all, 0),
      completed: own
        .filter(group => group.finishReason === 'completed')
        .reduce((sum, group) => sum + group._count._all, 0),
    };
  });
  await DB_CLIENT.use.emailLifecycleOperationalEvent.createMany({
    data: summaries.map(summary => ({
      id: createHash('sha256')
        .update(`cohort:${bucket.toISOString()}:${summary.cohort}`)
        .digest('hex'),
      kind: 'cohort_snapshot',
      state: 'cohort_snapshot',
      dimensions: summary,
      occurredAt: bucket,
    })),
    skipDuplicates: true,
  });
}

/** A failed/ambiguous export remains pending. UUID AND original timestamp stay fixed on retry. */
export async function exportLifecycleOperations(limit = 200): Promise<number> {
  if (!IS_PRODUCTION_ENV() || !ENV_VARS.POSTHOG_PROJECT_KEY) {
    return 0;
  }
  await enqueueCohortSnapshot();
  const pending = await DB_CLIENT.use.emailLifecycleOperationalEvent.findMany({
    where: { exportedAt: null },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    take: Math.min(Math.max(limit, 1), 500),
  });
  if (!pending.length) {
    return 0;
  }
  try {
    const response = await fetch(
      `${ENV_VARS.POSTHOG_HOST || 'https://eu.i.posthog.com'}/batch/`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: ENV_VARS.POSTHOG_PROJECT_KEY,
          batch: pending.map(operationalCapture),
        }),
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!response.ok) {
      throw Object.assign(
        new Error(
          `PostHog: eksport operacji mailowych zwrócił ${response.status}.`
        ),
        {
          retryable:
            response.status >= 500 ||
            response.status === 408 ||
            response.status === 429,
        }
      );
    }
    const acknowledgment: unknown = await response.json();
    if (
      typeof acknowledgment !== 'object' ||
      acknowledgment === null ||
      !('status' in acknowledgment) ||
      (acknowledgment.status !== 1 && acknowledgment.status !== 'Ok')
    ) {
      throw new Error(
        'PostHog: brak potwierdzenia przyjęcia operacji mailowych.'
      );
    }
  } catch (cause) {
    const error = new Error(
      cause instanceof Error
        ? cause.message
        : 'Lifecycle analytics export failed',
      { cause }
    );
    error.name = EXPORT_FAILURE_NAME;
    throw Object.assign(error, {
      pendingAgeMs: Math.max(
        0,
        Date.now() - (pending[0]?.occurredAt.getTime() ?? Date.now())
      ),
      pendingBatchSize: pending.length,
      retryable: !(
        typeof cause === 'object' &&
        cause !== null &&
        'retryable' in cause &&
        cause.retryable === false
      ),
    });
  }
  await DB_CLIENT.use.emailLifecycleOperationalEvent.updateMany({
    where: { id: { in: pending.map(row => row.id) }, exportedAt: null },
    data: { exportedAt: new Date() },
  });
  return pending.length;
}
