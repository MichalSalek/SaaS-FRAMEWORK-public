/**
 * Structural contract of the composed error map: every DomainError `type` has
 * exactly one responder, no two domain maps claim the same type, and the variants the golden table
 * (`test-utils/kernel-policies/error-mapper.table.test.ts`) does not list keep their exact status,
 * event and payload.
 */
import { describe, it, expect } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { PLAN_ID_MAP } from '@kernel/domain/stripe/stripe.config';
import { mapErrorToResponse } from '../error-mapper';
import type { DomainError } from './error-map.types';
import {
  DOMAIN_ERROR_MAP_PARTS,
  DOMAIN_ERROR_RESPONDERS,
} from './domain-error.map';
import { composeErrorMaps, findDuplicateErrorKeys } from './compose-error-maps';

const INFO = APP_EVENTS.INFO;

// Compile-time list of the whole union: `satisfies` rejects a missing type and a foreign one, so
// this object always equals the union the kernel defines.
const ALL_DOMAIN_ERROR_TYPES = {
  AUTH_UNAVAILABLE: true,
  ACCOUNT_NOT_FOUND: true,
  UNAUTHORIZED: true,
  VALIDATION_ERROR: true,
  DATABASE_ERROR: true,
  SERIALIZATION_CONFLICT: true,
  EXTERNAL_SERVICE_ERROR: true,
  CAPTCHA_VERIFICATION_FAILED: true,
  STYLIST_NOT_FOUND: true,
  ANNOUNCEMENT_NOT_FOUND: true,
  GALLERY_RECORD_NOT_FOUND: true,
  GALLERY_LIMIT_REACHED: true,
  GALLERY_RECORD_OWNERSHIP_ERROR: true,
  GALLERY_PIN_LIMIT_REACHED: true,
  GALLERY_RECORD_ALREADY_PINNED: true,
  GALLERY_RECORD_NOT_PINNED: true,
  GALLERY_PINNED_ORDER_STALE: true,
  PAIRING_SESSION_NOT_FOUND: true,
  PAIRING_LIMIT_REACHED: true,
  PAIRING_CODE_INVALID: true,
  PAIRING_TOO_MANY_ACTIVE_SESSIONS: true,
  PAIR_REQUEST_NOT_FOUND: true,
  PAIR_REQUEST_STYLIST_NOT_FOUND: true,
  BOOKMARK_ALREADY_EXISTS: true,
  RECORD_ALREADY_IN_FAVORITES: true,
  RECORD_NOT_IN_FAVORITES: true,
  RECORD_TO_ADD_NOT_FOUND: true,
  USER_NOT_FOUND: true,
  USER_EMAIL_ALREADY_IN_USE: true,
  EXPORT_RATE_LIMITED: true,
  USER_HAS_ACTIVE_SUBSCRIPTION: true,
  ACCOUNT_NOT_RECOVERABLE: true,
  ACCOUNT_VANITY_URL_TAKEN: true,
  ACCOUNT_VANITY_URL_RESERVED: true,
  BRANDING_PLAN_LOCKED: true,
  ACCOUNT_TRIAL_ALREADY_USED: true,
  ACCOUNT_TRIAL_NOT_ELIGIBLE: true,
  ACCOUNT_STRIPE_ERROR: true,
  CHECKOUT_ATTEMPT_BUSY: true,
  CHECKOUT_TERMS_CHANGED: true,
  CHECKOUT_PLAN_NOT_FOUND: true,
  CHECKOUT_PRICE_RESOLVE_FAILED: true,
  CHECKOUT_FREE_PLAN_CONFLICT: true,
  PLAN_CHANGE_NO_SUBSCRIPTION: true,
  PLAN_CHANGE_QUOTE_STALE: true,
  CHECKOUT_CUSTOMER_NOT_READY: true,
  ADMIN_INSUFFICIENT_PERMISSIONS: true,
  ADMIN_TARGET_PROTECTED: true,
  ADMIN_TARGET_NOT_FOUND: true,
  ADMIN_RESOURCE_HAS_REFERENCES: true,
  ADMIN_SYSTEM_ROLE_IMMUTABLE: true,
  ADMIN_POLICY_IS_MAIN_CANNOT_DELETE: true,
  ADMIN_DUPLICATE_RESOURCE_NAME: true,
  CHECK_ACCESS_URL_FORBIDDEN: true,
  CHECK_ACCESS_URL_NETWORK: true,
  IMPERSONATION_SENSITIVE_BLOCKED: true,
  SESSION_CONTAINER_NOT_FOUND: true,
  SESSION_CONTAINER_NOT_AUTHORIZED: true,
  SESSION_CONTAINER_NOT_PAIRED: true,
  SESSION_CONTAINER_MAX_ACTIVE_EXCEEDED: true,
  SESSION_CONTAINER_INVALID_STATE: true,
  SESSION_CONTAINER_EMPTY: true,
  SESSION_CONTAINER_PHOTO_OWNERSHIP: true,
  SESSION_CONTAINER_SHARE_QUOTA_EXCEEDED: true,
  SESSION_CONTAINER_PAIR_SESSION_EXISTS: true,
  CLIENT_NOT_FOUND: true,
  CLIENT_UNAUTHORIZED_ACCESS: true,
  CLIENT_CARD_PLAN_LOCKED: true,
  VISIT_NOT_FOUND: true,
  SALON_STAFF_NOT_FOUND: true,
  SALON_STAFF_ALREADY_EXISTS: true,
  SALON_STAFF_LIMIT_REACHED: true,
  SALON_STAFF_SELF_INVITE: true,
  EMAIL_INVALID_UNSUBSCRIBE_TOKEN: true,
  EMAIL_UNSUBSCRIBE_TOKEN_EXPIRED: true,
  EMAIL_USER_NOT_FOUND: true,
  EMAIL_TRANSACTIONAL_NOT_UNSUBSCRIBABLE: true,
  EMAIL_CHANGE_INVALID_TOKEN: true,
  DELETE_CONFIRM_INVALID_TOKEN: true,
  CONTENT_REPORT_NOT_FOUND: true,
  CONTENT_REPORT_ALREADY_RESOLVED: true,
  CONTENT_REPORT_RATE_LIMITED: true,
  CONTENT_REPORT_DUPLICATE: true,
  CONTENT_REPORT_DUPLICATE_PENDING: true,
  CONTENT_REPORT_SELF_REPORT: true,
  ALREADY_SUBSCRIBED: true,
  SUBSCRIBE_FAILED: true,
  NEWSLETTER_INVALID_TOKEN: true,
  NEWSLETTER_UNSUBSCRIBE_NOT_FOUND: true,
  SUPPORT_THREAD_NOT_FOUND: true,
  SUPPORT_THREAD_NOT_AUTHORIZED: true,
  SUPPORT_THREAD_CLOSED: true,
  SUPPORT_THREAD_STALE: true,
  SUPPORT_RATE_LIMITED: true,
  CONTACT_FORM_NO_ADMIN_EMAIL: true,
  MESSAGING_PAIR_NOT_FOUND: true,
  MESSAGING_NOT_ALLOWED: true,
  MESSAGING_RATE_LIMITED: true,
} satisfies Record<DomainError['type'], true>;

// Compile-time proof of the duplicate check: composing two maps that share a key turns the
// argument type into `{ duplicateErrorKeys: <key> }`, so a real call with such maps cannot compile.
type ComposeArgument<T extends readonly object[]> = Parameters<
  typeof composeErrorMaps<T>
>[0];
const duplicateRejectedAtCompileTime: ComposeArgument<
  readonly [{ ONE: 1; SHARED: 1 }, { SHARED: 1 }]
> extends { duplicateErrorKeys: 'SHARED' }
  ? true
  : false = true;
const disjointAcceptedAtCompileTime: ComposeArgument<
  readonly [{ ONE: 1 }, { TWO: 1 }]
> extends { duplicateErrorKeys: unknown }
  ? false
  : true = true;

const capture = (error: DomainError) => {
  const { res } = createMocks<NextApiRequest, NextApiResponse>();
  mapErrorToResponse(res, error);
  const body = res._getJSONData() as { event?: unknown; data?: unknown };
  return {
    status: res._getStatusCode(),
    event: body.event,
    data: body.data,
  };
};

type GoldenRow = readonly [
  error: DomainError,
  status: number,
  event: string,
  data: unknown,
];

// Variants the golden table does not list; each value was captured from the switch this map
// replaced (status, event and payload identical).
const GOLDEN_ROWS: readonly GoldenRow[] = [
  [
    { type: 'PAIR_REQUEST_NOT_FOUND', pairId: 'p_1' },
    404,
    INFO.PAIRING.PAIR_REQUEST_NOT_FOUND,
    { pairId: 'p_1' },
  ],
  [
    { type: 'PAIR_REQUEST_STYLIST_NOT_FOUND', stylistAccountId: 'sa_1' },
    404,
    INFO.PAIRING.PAIR_REQUEST_UNAVAILABLE,
    { stylistAccountId: 'sa_1' },
  ],
  [
    { type: 'BRANDING_PLAN_LOCKED', accountId: 'a_1' },
    403,
    INFO.APPLICATION.ACCESS_DENIED_INFO,
    { accountId: 'a_1' },
  ],
  [
    { type: 'CHECKOUT_PLAN_NOT_FOUND', planId: PLAN_ID_MAP.PRO },
    400,
    INFO.ACCOUNT.CANNOT_MAKE_PAYMENT,
    { planId: PLAN_ID_MAP.PRO },
  ],
  [
    {
      type: 'CHECKOUT_PRICE_RESOLVE_FAILED',
      planId: PLAN_ID_MAP.PRO,
      billingPeriod: 'monthly',
    },
    500,
    INFO.APPLICATION.GENERAL_ERROR,
    undefined,
  ],
  [
    { type: 'CHECKOUT_ATTEMPT_BUSY', accountId: 'a_1', retryAfterSeconds: 5 },
    409,
    INFO.ACCOUNT.CHECKOUT_ATTEMPT_BUSY,
    { retryAfterSeconds: 5 },
  ],
  [
    { type: 'CHECKOUT_TERMS_CHANGED', trialDays: 0 },
    409,
    INFO.APPLICATION.VALIDATION_FAILED,
    {
      field: 'expectedTrialDays',
      code: 'CHECKOUT_TERMS_CHANGED',
      trialDays: 0,
    },
  ],
  [
    { type: 'CHECKOUT_FREE_PLAN_CONFLICT', accountId: 'a_1' },
    400,
    INFO.ACCOUNT.CANNOT_CHANGE_PRICING_PLAN,
    { accountId: 'a_1' },
  ],
  [
    { type: 'PLAN_CHANGE_NO_SUBSCRIPTION', accountId: 'a_1' },
    400,
    INFO.ACCOUNT.CANNOT_CHANGE_PRICING_PLAN,
    { accountId: 'a_1' },
  ],
  [
    { type: 'PLAN_CHANGE_QUOTE_STALE', reason: 'canceling' },
    409,
    INFO.APPLICATION.VALIDATION_FAILED,
    { field: 'quoteId', reason: 'canceling' },
  ],
  [
    { type: 'PLAN_CHANGE_QUOTE_STALE', reason: 'expired' },
    409,
    INFO.APPLICATION.VALIDATION_FAILED,
    { field: 'quoteId', reason: 'expired' },
  ],
  [
    { type: 'PLAN_CHANGE_QUOTE_STALE', reason: 'changed' },
    409,
    INFO.APPLICATION.VALIDATION_FAILED,
    { field: 'quoteId', reason: 'changed' },
  ],
  [
    { type: 'PLAN_CHANGE_QUOTE_STALE', reason: 'invalid' },
    409,
    INFO.APPLICATION.VALIDATION_FAILED,
    { field: 'quoteId', reason: 'invalid' },
  ],
  [
    { type: 'CLIENT_CARD_PLAN_LOCKED', planType: 'FREE' },
    403,
    INFO.VISIT.CLIENT_CARD_PLAN_LOCKED,
    { planType: 'FREE' },
  ],
  [
    { type: 'VISIT_NOT_FOUND', visitId: 'v_1' },
    404,
    INFO.VISIT.VISIT_NOT_FOUND,
    { visitId: 'v_1' },
  ],
  [
    { type: 'SUPPORT_RATE_LIMITED', currentCount: 5, limit: 5 },
    429,
    INFO.APPLICATION.RATE_LIMIT_EXCEEDED_INFO,
    undefined,
  ],
  [
    { type: 'MESSAGING_PAIR_NOT_FOUND' },
    404,
    INFO.MESSAGING.MESSAGING_PAIR_NOT_FOUND,
    undefined,
  ],
  [
    { type: 'MESSAGING_NOT_ALLOWED' },
    403,
    INFO.MESSAGING.MESSAGING_NOT_ALLOWED,
    undefined,
  ],
  [
    { type: 'MESSAGING_RATE_LIMITED', retryAfterSeconds: 30 },
    429,
    INFO.APPLICATION.RATE_LIMIT_EXCEEDED_INFO,
    { retryAfter: 30 },
  ],
];

describe('composed DomainError map', () => {
  it('no two domain maps claim the same error type', () => {
    expect(findDuplicateErrorKeys(DOMAIN_ERROR_MAP_PARTS)).toEqual([]);
    const partKeyCount = DOMAIN_ERROR_MAP_PARTS.reduce(
      (sum, part) => sum + Object.keys(part).length,
      0
    );
    expect(Object.keys(DOMAIN_ERROR_RESPONDERS)).toHaveLength(partKeyCount);
  });

  it('covers exactly the DomainError union', () => {
    expect(Object.keys(DOMAIN_ERROR_RESPONDERS).sort()).toEqual(
      Object.keys(ALL_DOMAIN_ERROR_TYPES).sort()
    );
  });

  it('rejects a duplicate key at compile time and at load', () => {
    expect(duplicateRejectedAtCompileTime).toBe(true);
    expect(disjointAcceptedAtCompileTime).toBe(true);
    // A non-tuple array hides the keys from the type check, so only the load-time throw guards it.
    const overlapping: readonly object[] = [
      { ONE: () => undefined, SHARED: () => undefined },
      { SHARED: () => undefined },
    ];
    expect(() => composeErrorMaps(overlapping)).toThrow(
      /duplicate error types SHARED/
    );
  });

  it.each(GOLDEN_ROWS)(
    '%o keeps status, event and payload',
    (error, status, event, data) => {
      expect(capture(error)).toEqual({ status, event, data });
    }
  );

  it('an untyped value outside the union still gets the opaque 500', () => {
    const { res } = createMocks<NextApiRequest, NextApiResponse>();
    const rogue: unknown = { type: 'NOT_A_DOMAIN_ERROR' };
    mapErrorToResponse(res, rogue as DomainError);
    expect(res._getStatusCode()).toBe(500);
    expect((res._getJSONData() as { event?: unknown }).event).toBe(
      INFO.APPLICATION.GENERAL_ERROR
    );
  });

  it('a prototype key is not mistaken for a responder', () => {
    const { res } = createMocks<NextApiRequest, NextApiResponse>();
    const rogue: unknown = { type: 'toString' };
    mapErrorToResponse(res, rogue as DomainError);
    expect(res._getStatusCode()).toBe(500);
  });
});
