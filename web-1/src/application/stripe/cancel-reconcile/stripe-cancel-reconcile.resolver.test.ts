/**
 * Unit tests for stripe-cancel-reconcile.resolver.ts — the pure decision logic
 * behind the subscription-cancel dead-letter sweep (no Prisma/Stripe mocks;
 * project pattern: pure policy tests).
 */

import { describe, it, expect } from 'vitest';
import {
  CANCEL_RECONCILE_BACKOFF_BASE_MS,
  CANCEL_RECONCILE_DUPLICATE_EVENT_ID_PREFIX,
  CANCEL_RECONCILE_EVENT_ID_PREFIX,
  CANCEL_RECONCILE_MAX_RETRIES,
  buildCancelReconcileEventId,
  extractStripeErrorShape,
  isAlreadyCanceledCancelError,
  isCancelRetryDue,
  parseCancelReconcileEventId,
  truncateReconcileError,
} from './stripe-cancel-reconcile.resolver';

describe('cancel-reconcile event_id build/parse', () => {
  it('round-trips a deletion-flavor subscription/user pair (default flavor)', () => {
    const target = {
      subscriptionId: 'sub_1QaBcDeFgHiJkL',
      userId: 'cmc3xyzuser0001abcd',
    };
    const eventId = buildCancelReconcileEventId(target);

    expect(eventId).toBe(
      `${CANCEL_RECONCILE_EVENT_ID_PREFIX}sub_1QaBcDeFgHiJkL:cmc3xyzuser0001abcd`
    );
    expect(parseCancelReconcileEventId(eventId)).toEqual({
      ...target,
      flavor: 'deletion',
    });
  });

  it('round-trips a duplicate-flavor pair with the disjoint duplicate prefix', () => {
    const eventId = buildCancelReconcileEventId({
      subscriptionId: 'sub_dupOldSub01',
      userId: 'cmcdupuser0001abcd',
      flavor: 'duplicate',
    });

    expect(eventId).toBe(
      `${CANCEL_RECONCILE_DUPLICATE_EVENT_ID_PREFIX}sub_dupOldSub01:cmcdupuser0001abcd`
    );
    // Must NOT be mis-parsed as deletion — the duplicate prefix is disjoint from
    // the deletion prefix (deletion-stem + "-duplicate:").
    expect(eventId.startsWith(CANCEL_RECONCILE_EVENT_ID_PREFIX)).toBe(false);
    expect(parseCancelReconcileEventId(eventId)).toEqual({
      subscriptionId: 'sub_dupOldSub01',
      userId: 'cmcdupuser0001abcd',
      flavor: 'duplicate',
    });
  });

  it('rejects real Stripe event ids (no internal prefix)', () => {
    expect(parseCancelReconcileEventId('evt_1QaBcDeFgHiJkL')).toBeNull();
  });

  it('rejects a malformed key with missing segments', () => {
    expect(
      parseCancelReconcileEventId(`${CANCEL_RECONCILE_EVENT_ID_PREFIX}sub_only`)
    ).toBeNull();
    expect(
      parseCancelReconcileEventId(
        `${CANCEL_RECONCILE_EVENT_ID_PREFIX}sub_x:user:extra`
      )
    ).toBeNull();
  });

  it('rejects empty segments', () => {
    expect(
      parseCancelReconcileEventId(`${CANCEL_RECONCILE_EVENT_ID_PREFIX}:user1`)
    ).toBeNull();
    expect(
      parseCancelReconcileEventId(`${CANCEL_RECONCILE_EVENT_ID_PREFIX}sub_x:`)
    ).toBeNull();
  });
});

describe('isCancelRetryDue — exponential backoff gate', () => {
  const base = CANCEL_RECONCILE_BACKOFF_BASE_MS;
  const at = (ms: number): Date => new Date(ms);

  it('fresh row (retryCount=0) is due exactly after one base window', () => {
    expect(
      isCancelRetryDue({
        retryCount: 0,
        lastAttemptAt: at(0),
        now: at(base - 1),
      })
    ).toBe(false);
    expect(
      isCancelRetryDue({ retryCount: 0, lastAttemptAt: at(0), now: at(base) })
    ).toBe(true);
  });

  it('doubles the window per retry (retryCount=3 → 8× base)', () => {
    expect(
      isCancelRetryDue({
        retryCount: 3,
        lastAttemptAt: at(0),
        now: at(8 * base - 1),
      })
    ).toBe(false);
    expect(
      isCancelRetryDue({
        retryCount: 3,
        lastAttemptAt: at(0),
        now: at(8 * base),
      })
    ).toBe(true);
  });

  it('bounds the exponent at MAX_RETRIES (hand-edited retry_count cannot overflow)', () => {
    const cappedWindow = base * 2 ** CANCEL_RECONCILE_MAX_RETRIES;
    expect(
      isCancelRetryDue({
        retryCount: 40,
        lastAttemptAt: at(0),
        now: at(cappedWindow),
      })
    ).toBe(true);
  });

  it('treats a negative retry_count as 0 (defensive)', () => {
    expect(
      isCancelRetryDue({ retryCount: -1, lastAttemptAt: at(0), now: at(base) })
    ).toBe(true);
  });
});

describe('extractStripeErrorShape', () => {
  it('reads code + statusCode from a Stripe-like error', () => {
    const error = Object.assign(new Error('No such subscription'), {
      code: 'resource_missing',
      statusCode: 404,
    });
    expect(extractStripeErrorShape(error)).toEqual({
      code: 'resource_missing',
      status: 404,
      message: 'No such subscription',
    });
  });

  it('falls back to `status` when `statusCode` is absent', () => {
    const error = Object.assign(new Error('boom'), { status: 500 });
    expect(extractStripeErrorShape(error).status).toBe(500);
  });

  it('handles non-Error throwables without exploding', () => {
    expect(extractStripeErrorShape('string failure')).toEqual({
      code: undefined,
      status: undefined,
      message: 'string failure',
    });
  });
});

describe('isAlreadyCanceledCancelError — idempotent end-state classification', () => {
  it('resource_missing is idempotent success regardless of status', () => {
    expect(
      isAlreadyCanceledCancelError({
        code: 'resource_missing',
        status: 404,
        message: 'No such subscription',
      })
    ).toBe(true);
  });

  it('400 with "already canceled" wording is idempotent success', () => {
    expect(
      isAlreadyCanceledCancelError({
        code: undefined,
        status: 400,
        message: 'This subscription has been canceled.',
      })
    ).toBe(true);
    expect(
      isAlreadyCanceledCancelError({
        code: undefined,
        status: 400,
        message: 'Subscription already cancelled',
      })
    ).toBe(true);
  });

  it('non-400 statuses without resource_missing are NOT idempotent success', () => {
    expect(
      isAlreadyCanceledCancelError({
        code: undefined,
        status: 500,
        message: 'has been canceled', // wording alone must not win on a 5xx
      })
    ).toBe(false);
  });

  it('generic failures stay failures', () => {
    expect(
      isAlreadyCanceledCancelError({
        code: 'rate_limit',
        status: 429,
        message: 'Too many requests',
      })
    ).toBe(false);
    expect(
      isAlreadyCanceledCancelError({
        code: undefined,
        status: undefined,
        message: 'network timeout',
      })
    ).toBe(false);
  });
});

describe('truncateReconcileError', () => {
  it('passes short messages through unchanged', () => {
    expect(truncateReconcileError('short')).toBe('short');
  });

  it('caps oversized messages with an ellipsis', () => {
    const long = 'x'.repeat(5_000);
    const stored = truncateReconcileError(long);
    expect(stored.length).toBe(2_001); // 2000 chars + ellipsis
    expect(stored.endsWith('…')).toBe(true);
  });
});
