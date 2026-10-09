/**
 * Golden-master TABLE test — `mapErrorToResponse` (error-mapper.ts).
 *
 * WHAT THIS PROTECTS
 * ──────────────────
 * error-mapper.ts is a 705-LOC monolithic exhaustive switch over the WHOLE
 * `DomainError` union (every domain's error type + the common errors). Its
 * completeness is enforced at compile time by `const _exhaustive: never` in the
 * default branch (see the DECISION comment in the source — the switch is
 * deliberately NOT split). This test pins the *runtime* contract that the type
 * system cannot: for every concrete error variant, which HTTP **status** and which
 * envelope **event** the client actually receives.
 *
 * A change to the union, a reordered `if` inside a multi-reason case (UNAUTHORIZED,
 * PAIRING_CODE_INVALID), or a swapped `respond*` helper would flip a row here.
 *
 * METHOD
 * ──────
 * Pure unit test — drives the mapper directly with `node-mocks-http`'s `createMocks`
 * (NO handler middleware, NO DB/auth mocks). Each row is `[label, error, status,
 * event]`; we call `mapErrorToResponse(res, error)` and assert
 * `res._getStatusCode()` + `res._getJSONData().event`.
 *
 * Expected `event` strings come from `APP_EVENTS` (SSOT) — never hardcoded — so a
 * rename of an INFO event reference in the mapper surfaces as a mismatch, not a
 * silent string drift. Expected status codes ARE literals (the HTTP contract is the
 * thing under test; a literal is the golden value).
 *
 * COVERAGE
 * ────────
 * Every `case` label in the switch, every sub-reason of the multi-reason cases
 * (UNAUTHORIZED ×4 reasons, PAIRING_CODE_INVALID ×5 reasons), and every shared
 * fall-through group (plan-limit ×3, opaque-500 ×6). The `_exhaustive: never`
 * default branch is unreachable by construction (covered by tsc, not here).
 */

import { describe, it, expect } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse, type DomainError } from '@app/http/error-mapper';

const INFO = APP_EVENTS.INFO;

// Run the mapper against a fresh mock response and read back (status, event).
const runMapper = (error: DomainError): { status: number; event: unknown } => {
  const { res } = createMocks<NextApiRequest, NextApiResponse>();
  mapErrorToResponse(res, error);
  // node-mocks-http >=1.18 zwraca `unknown` z `_getJSONData()` (wczesniej `any`),
  // wiec odczyt koperty API `{ event, data }` musi byc jawnie zawezony. Repo zabrania
  // `any` (ratchet typescript-strictness), stad minimalny ksztalt zamiast kastu na any.
  const body = res._getJSONData() as { event?: unknown };
  return { status: res._getStatusCode(), event: body.event };
};

type Row = readonly [
  label: string,
  error: DomainError,
  status: number,
  event: string,
];

// ─────────────────────────────────────────────────────────────────────────────
// THE TABLE — one row per reachable switch case / sub-reason / fall-through.
// ─────────────────────────────────────────────────────────────────────────────
const ROWS: readonly Row[] = [
  // ── Common errors ──
  [
    'ACCOUNT_NOT_FOUND',
    { type: 'ACCOUNT_NOT_FOUND', accountId: 'acc_1' },
    404,
    INFO.ACCOUNT.ACCOUNT_NOT_FOUND,
  ],
  // UNAUTHORIZED — 4 reasons: 403 for the three logged-in refusals, 401 only when credentials did not resolve.
  [
    'UNAUTHORIZED/MISSING_PERMISSION → 403 (logged-in user, S122)',
    {
      type: 'UNAUTHORIZED',
      reason: 'MISSING_PERMISSION',
      requiredPermission: 'SOME_EVENT',
    },
    403,
    INFO.USER.UNAUTHORIZED,
  ],
  [
    'UNAUTHORIZED/WRONG_ACCOUNT_TYPE → 403 (logged-in user, S122)',
    {
      type: 'UNAUTHORIZED',
      reason: 'WRONG_ACCOUNT_TYPE',
      requiredAccountType: 'STYLIST',
    },
    403,
    INFO.USER.UNAUTHORIZED,
  ],
  [
    'UNAUTHORIZED/ACCOUNT_INACTIVE → 403 (respondForbidden, not 401)',
    {
      type: 'UNAUTHORIZED',
      reason: 'ACCOUNT_INACTIVE',
      currentStatus: 'EXPIRED',
    },
    403,
    INFO.APPLICATION.ACCESS_DENIED_INFO,
  ],
  [
    'UNAUTHORIZED/SESSION_EXPIRED → 401 (else branch)',
    { type: 'UNAUTHORIZED', reason: 'SESSION_EXPIRED' },
    401,
    INFO.USER.UNAUTHORIZED,
  ],
  [
    'VALIDATION_ERROR',
    { type: 'VALIDATION_ERROR', field: 'email', message: 'bad' },
    400,
    INFO.APPLICATION.VALIDATION_FAILED,
  ],
  // DATABASE_ERROR — opaque 500 unless the failure is request-attributable
  // (classifyQueryFailure → reason): unique race 409, dangling FK / bad value 400.
  [
    'DATABASE_ERROR → opaque 500',
    { type: 'DATABASE_ERROR', operation: 'findUser' },
    500,
    INFO.APPLICATION.GENERAL_ERROR,
  ],
  [
    'DATABASE_ERROR/UNIQUE_CONFLICT → 409',
    { type: 'DATABASE_ERROR', operation: 'x', reason: 'UNIQUE_CONFLICT' },
    409,
    INFO.APPLICATION.VALIDATION_FAILED,
  ],
  [
    'DATABASE_ERROR/REFERENCE_MISSING → 400',
    { type: 'DATABASE_ERROR', operation: 'x', reason: 'REFERENCE_MISSING' },
    400,
    INFO.APPLICATION.VALIDATION_FAILED,
  ],
  [
    'DATABASE_ERROR/INVALID_INPUT → 400',
    { type: 'DATABASE_ERROR', operation: 'x', reason: 'INVALID_INPUT' },
    400,
    INFO.APPLICATION.VALIDATION_FAILED,
  ],
  [
    'EXTERNAL_SERVICE_ERROR → opaque 500',
    { type: 'EXTERNAL_SERVICE_ERROR', service: 'STRIPE', operation: 'charge' },
    500,
    INFO.APPLICATION.GENERAL_ERROR,
  ],
  // CAPTCHA_VERIFICATION_FAILED — anti-bot (Turnstile) 403. SECURITY: the
  // diagnostic `reason` is NEVER echoed (payload-less respondForbidden) — the
  // event alone reaches the client; codes would coach a bot on its bypass attempts.
  [
    'CAPTCHA_VERIFICATION_FAILED → 403',
    { type: 'CAPTCHA_VERIFICATION_FAILED', reason: 'invalid-input-response' },
    403,
    INFO.PUBLIC.CAPTCHA_VERIFICATION_FAILED,
  ],
  [
    'STYLIST_NOT_FOUND',
    { type: 'STYLIST_NOT_FOUND', stylistAccountId: 'sa_1' },
    404,
    INFO.APPLICATION.NOT_FOUND,
  ],
  [
    'ANNOUNCEMENT_NOT_FOUND',
    { type: 'ANNOUNCEMENT_NOT_FOUND', announcementId: 'ann_1' },
    404,
    INFO.APPLICATION.NOT_FOUND,
  ],

  // ── Gallery errors ──
  [
    'GALLERY_RECORD_NOT_FOUND',
    { type: 'GALLERY_RECORD_NOT_FOUND', recordId: 'gr_1' },
    404,
    INFO.GALLERY.CANNOT_GET_GALLERY_RECORD,
  ],
  // plan-limit fall-through ×3 (all → 403 PLAN_LIMIT_REACHED_INFO).
  [
    'GALLERY_LIMIT_REACHED → 403 plan-limit',
    {
      type: 'GALLERY_LIMIT_REACHED',
      currentCount: 10,
      limit: 10,
      planType: 'FREE',
    },
    403,
    INFO.APPLICATION.PLAN_LIMIT_REACHED_INFO,
  ],
  [
    'PAIRING_LIMIT_REACHED → 403 plan-limit',
    {
      type: 'PAIRING_LIMIT_REACHED',
      currentCount: 5,
      limit: 5,
      planType: 'PLATFORM',
    },
    403,
    INFO.APPLICATION.PLAN_LIMIT_REACHED_INFO,
  ],
  [
    'SALON_STAFF_LIMIT_REACHED → 403 plan-limit',
    {
      type: 'SALON_STAFF_LIMIT_REACHED',
      currentCount: 3,
      limit: 3,
      planType: 'STUDIO',
    },
    403,
    INFO.APPLICATION.PLAN_LIMIT_REACHED_INFO,
  ],
  [
    'GALLERY_RECORD_OWNERSHIP_ERROR → 403 default access-denied',
    {
      type: 'GALLERY_RECORD_OWNERSHIP_ERROR',
      recordId: 'gr_1',
      ownerId: 'o_1',
      requesterId: 'r_1',
    },
    403,
    INFO.APPLICATION.ACCESS_DENIED_INFO,
  ],
  [
    'GALLERY_PIN_LIMIT_REACHED → 403 pin-limit event',
    { type: 'GALLERY_PIN_LIMIT_REACHED', currentPinned: 3, limit: 3 },
    403,
    INFO.GALLERY.GALLERY_PIN_LIMIT_REACHED,
  ],
  [
    'GALLERY_RECORD_ALREADY_PINNED → 400',
    { type: 'GALLERY_RECORD_ALREADY_PINNED', recordId: 'gr_1' },
    400,
    INFO.GALLERY.GALLERY_RECORD_ALREADY_PINNED,
  ],
  [
    'GALLERY_RECORD_NOT_PINNED → 400',
    { type: 'GALLERY_RECORD_NOT_PINNED', recordId: 'gr_1' },
    400,
    INFO.GALLERY.GALLERY_RECORD_NOT_PINNED,
  ],

  // ── Pairing errors ──
  [
    'PAIRING_SESSION_NOT_FOUND',
    { type: 'PAIRING_SESSION_NOT_FOUND', sessionId: 'ps_1' },
    404,
    INFO.PAIRING.PAIRING_NOT_FOUND,
  ],
  // PAIRING_CODE_INVALID — 5 reasons, each maps to a distinct 400 event.
  [
    'PAIRING_CODE_INVALID/NOT_FOUND',
    { type: 'PAIRING_CODE_INVALID', code: 'C', reason: 'NOT_FOUND' },
    400,
    INFO.PAIRING.INVALID_PAIRING_TOKEN,
  ],
  [
    'PAIRING_CODE_INVALID/EXPIRED',
    { type: 'PAIRING_CODE_INVALID', code: 'C', reason: 'EXPIRED' },
    400,
    INFO.PAIRING.PAIRING_TOKEN_EXPIRED,
  ],
  [
    'PAIRING_CODE_INVALID/REVOKED',
    { type: 'PAIRING_CODE_INVALID', code: 'C', reason: 'REVOKED' },
    400,
    INFO.PAIRING.PAIRING_TOKEN_REVOKED,
  ],
  [
    'PAIRING_CODE_INVALID/ALREADY_CLAIMED',
    { type: 'PAIRING_CODE_INVALID', code: 'C', reason: 'ALREADY_CLAIMED' },
    400,
    INFO.PAIRING.PAIRING_TOKEN_ALREADY_CLAIMED,
  ],
  [
    'PAIRING_CODE_INVALID/STYLIST_INACTIVE',
    { type: 'PAIRING_CODE_INVALID', code: 'C', reason: 'STYLIST_INACTIVE' },
    400,
    INFO.PAIRING.PAIRING_STYLIST_INACTIVE,
  ],
  [
    'PAIRING_TOO_MANY_ACTIVE_SESSIONS → 429',
    { type: 'PAIRING_TOO_MANY_ACTIVE_SESSIONS', currentCount: 9, limit: 9 },
    429,
    INFO.PAIRING.TOO_MANY_ACTIVE_SESSIONS,
  ],

  // ── Favorite errors ──
  [
    'BOOKMARK_ALREADY_EXISTS → 400',
    {
      type: 'BOOKMARK_ALREADY_EXISTS',
      stylistAccountId: 'sa_1',
      clientUserId: 'cu_1',
    },
    400,
    INFO.FAVORITE.STYLIST_ALREADY_BOOKMARKED,
  ],
  [
    'RECORD_ALREADY_IN_FAVORITES → 400',
    { type: 'RECORD_ALREADY_IN_FAVORITES', recordId: 'gr_1', userId: 'u_1' },
    400,
    INFO.FAVORITE.RECORD_ALREADY_IN_FAVORITES,
  ],
  [
    'RECORD_NOT_IN_FAVORITES → 404',
    { type: 'RECORD_NOT_IN_FAVORITES', recordId: 'gr_1', userId: 'u_1' },
    404,
    INFO.FAVORITE.RECORD_NOT_IN_FAVORITES,
  ],
  [
    'RECORD_TO_ADD_NOT_FOUND → 404 (IDOR-masked)',
    { type: 'RECORD_TO_ADD_NOT_FOUND', recordId: 'gr_1' },
    404,
    INFO.FAVORITE.CANNOT_ADD_RECORD_TO_FAVORITES,
  ],

  // ── User errors ──
  [
    'USER_NOT_FOUND → 404',
    { type: 'USER_NOT_FOUND', userId: 'u_1' },
    404,
    INFO.USER.USER_NOT_FOUND,
  ],
  [
    'USER_EMAIL_ALREADY_IN_USE → 400 (email not echoed)',
    { type: 'USER_EMAIL_ALREADY_IN_USE', email: 'x@y.z' },
    400,
    INFO.USER.EMAIL_ALREADY_EXISTS,
  ],
  [
    'EXPORT_RATE_LIMITED → 429',
    {
      type: 'EXPORT_RATE_LIMITED',
      lastExportAt: '2026-01-01T00:00:00.000Z',
      nextAvailableAt: '2026-01-08T00:00:00.000Z',
    },
    429,
    INFO.USER.USER_DATA_EXPORT_RATE_LIMITED,
  ],
  [
    'USER_HAS_ACTIVE_SUBSCRIPTION → 409',
    {
      type: 'USER_HAS_ACTIVE_SUBSCRIPTION',
      userId: 'u_1',
      subscriptionStatus: 'ACTIVE',
    },
    409,
    INFO.USER.CANNOT_DISABLE_ACTIVE_SUBSCRIPTION,
  ],
  [
    'ACCOUNT_NOT_RECOVERABLE → 409',
    { type: 'ACCOUNT_NOT_RECOVERABLE', userId: 'u_1' },
    409,
    INFO.USER.ACCOUNT_REACTIVATION_FAILED,
  ],

  // ── Account errors ──
  [
    'ACCOUNT_VANITY_URL_TAKEN → 400',
    { type: 'ACCOUNT_VANITY_URL_TAKEN', vanityUrl: 'foo' },
    400,
    INFO.ACCOUNT.VANITY_URL_ALREADY_EXISTS,
  ],
  [
    'ACCOUNT_VANITY_URL_RESERVED → 400',
    { type: 'ACCOUNT_VANITY_URL_RESERVED', vanityUrl: 'admin' },
    400,
    INFO.ACCOUNT.VANITY_URL_RESERVED,
  ],
  [
    'ACCOUNT_TRIAL_ALREADY_USED → 400',
    { type: 'ACCOUNT_TRIAL_ALREADY_USED', accountId: 'acc_1' },
    400,
    INFO.ACCOUNT.TRIAL_ALREADY_USED,
  ],
  [
    'ACCOUNT_TRIAL_NOT_ELIGIBLE → 400',
    {
      type: 'ACCOUNT_TRIAL_NOT_ELIGIBLE',
      accountId: 'acc_1',
      reason: 'no trial',
    },
    400,
    INFO.ACCOUNT.TRIAL_NOT_ELIGIBLE,
  ],
  [
    'CHECKOUT_CUSTOMER_NOT_READY → 409',
    { type: 'CHECKOUT_CUSTOMER_NOT_READY', accountId: 'acc_1' },
    409,
    INFO.ACCOUNT.CANNOT_MAKE_PAYMENT,
  ],
  // opaque-500 fall-through group ×4 (ACCOUNT_STRIPE_ERROR + CHECK_ACCESS_URL_NETWORK
  // + CONTACT_FORM_NO_ADMIN_EMAIL + SUBSCRIBE_FAILED) — all → 500 GENERAL_ERROR.
  [
    'ACCOUNT_STRIPE_ERROR → opaque 500',
    {
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'portal',
      stripeError: 'secret',
    },
    500,
    INFO.APPLICATION.GENERAL_ERROR,
  ],
  [
    'CHECK_ACCESS_URL_NETWORK → opaque 500',
    { type: 'CHECK_ACCESS_URL_NETWORK', reason: 'TIMEOUT' },
    500,
    INFO.APPLICATION.GENERAL_ERROR,
  ],
  [
    'CONTACT_FORM_NO_ADMIN_EMAIL → opaque 500',
    { type: 'CONTACT_FORM_NO_ADMIN_EMAIL' },
    500,
    INFO.APPLICATION.GENERAL_ERROR,
  ],
  [
    'SUBSCRIBE_FAILED → opaque 500',
    { type: 'SUBSCRIBE_FAILED', reason: 'mailgun down' },
    500,
    INFO.APPLICATION.GENERAL_ERROR,
  ],

  // ── Admin errors ──
  [
    'ADMIN_INSUFFICIENT_PERMISSIONS → 403',
    {
      type: 'ADMIN_INSUFFICIENT_PERMISSIONS',
      requiredRole: 'MASTER_ADMIN',
      currentRole: 'STYLIST',
    },
    403,
    INFO.APPLICATION.ACCESS_DENIED_INFO,
  ],
  [
    'ADMIN_TARGET_NOT_FOUND → 404',
    { type: 'ADMIN_TARGET_NOT_FOUND', targetId: 't_1', targetType: 'USER' },
    404,
    INFO.APPLICATION.NOT_FOUND,
  ],
  [
    'ADMIN_TARGET_PROTECTED → 403',
    { type: 'ADMIN_TARGET_PROTECTED', reason: 'ADMIN_CANNOT_TARGET_SELF' },
    403,
    INFO.APPLICATION.ACCESS_DENIED_INFO,
  ],
  [
    'ADMIN_POLICY_IS_MAIN_CANNOT_DELETE → 400',
    { type: 'ADMIN_POLICY_IS_MAIN_CANNOT_DELETE', policyId: 'p_1' },
    400,
    INFO.ADMIN.CANNOT_DELETE_MAIN_POLICY,
  ],
  [
    'ADMIN_RESOURCE_HAS_REFERENCES → 400',
    {
      type: 'ADMIN_RESOURCE_HAS_REFERENCES',
      resourceId: 'r_1',
      resourceType: 'COLOR',
      referenceCount: 4,
    },
    400,
    INFO.ADMIN.RESOURCE_HAS_REFERENCES,
  ],
  [
    'ADMIN_DUPLICATE_RESOURCE_NAME → 409 (maps to VALIDATION_FAILED event)',
    {
      type: 'ADMIN_DUPLICATE_RESOURCE_NAME',
      resourceType: 'TRAIT',
      name: 'Glossy',
    },
    409,
    INFO.APPLICATION.VALIDATION_FAILED,
  ],
  [
    'ADMIN_SYSTEM_ROLE_IMMUTABLE → 403',
    { type: 'ADMIN_SYSTEM_ROLE_IMMUTABLE', roleId: 'role_master_admin' },
    403,
    INFO.APPLICATION.ACCESS_DENIED_INFO,
  ],
  [
    'IMPERSONATION_SENSITIVE_BLOCKED → 403',
    {
      type: 'IMPERSONATION_SENSITIVE_BLOCKED',
      command: 'USER_REQUEST_EMAIL_CHANGE',
      adminUserId: 'a_1',
      targetUserId: 't_1',
    },
    403,
    INFO.ADMIN.IMPERSONATION_SENSITIVE_BLOCKED,
  ],
  [
    'CHECK_ACCESS_URL_FORBIDDEN → 403 default access-denied',
    { type: 'CHECK_ACCESS_URL_FORBIDDEN' },
    403,
    INFO.APPLICATION.ACCESS_DENIED_INFO,
  ],

  // ── Client errors ──
  [
    'CLIENT_NOT_FOUND → 404',
    { type: 'CLIENT_NOT_FOUND', clientId: 'c_1' },
    404,
    INFO.APPLICATION.NOT_FOUND,
  ],
  [
    'CLIENT_UNAUTHORIZED_ACCESS → 403',
    {
      type: 'CLIENT_UNAUTHORIZED_ACCESS',
      clientId: 'c_1',
      stylistAccountId: 'sa_1',
    },
    403,
    INFO.CLIENT.NOT_PAIRED_WITH_CLIENT,
  ],

  // ── SalonStaff errors ──
  [
    'SALON_STAFF_NOT_FOUND → 404',
    { type: 'SALON_STAFF_NOT_FOUND', staffId: 's_1' },
    404,
    INFO.APPLICATION.NOT_FOUND,
  ],
  [
    'SALON_STAFF_ALREADY_EXISTS → 400 (email not echoed)',
    {
      type: 'SALON_STAFF_ALREADY_EXISTS',
      email: 'x@y.z',
      salonAccountId: 'sa_1',
    },
    400,
    INFO.SALON_STAFF.STAFF_ALREADY_EXISTS,
  ],
  [
    'SALON_STAFF_SELF_INVITE → 400',
    { type: 'SALON_STAFF_SELF_INVITE', accountId: 'acc_1' },
    400,
    INFO.SALON_STAFF.CANNOT_INVITE_STAFF,
  ],

  // ── Email errors ──
  [
    'EMAIL_INVALID_UNSUBSCRIBE_TOKEN → 400',
    { type: 'EMAIL_INVALID_UNSUBSCRIBE_TOKEN' },
    400,
    INFO.APPLICATION.VALIDATION_FAILED,
  ],
  [
    'EMAIL_UNSUBSCRIBE_TOKEN_EXPIRED → 400',
    { type: 'EMAIL_UNSUBSCRIBE_TOKEN_EXPIRED' },
    400,
    INFO.APPLICATION.VALIDATION_FAILED,
  ],
  [
    'EMAIL_USER_NOT_FOUND → 404 (userId not echoed)',
    { type: 'EMAIL_USER_NOT_FOUND', userId: 'u_1' },
    404,
    INFO.APPLICATION.NOT_FOUND,
  ],
  [
    'EMAIL_TRANSACTIONAL_NOT_UNSUBSCRIBABLE → 400',
    {
      type: 'EMAIL_TRANSACTIONAL_NOT_UNSUBSCRIBABLE',
      category: 'TRANSACTIONAL',
    },
    400,
    INFO.APPLICATION.VALIDATION_FAILED,
  ],
  [
    'EMAIL_CHANGE_INVALID_TOKEN → 400',
    { type: 'EMAIL_CHANGE_INVALID_TOKEN' },
    400,
    INFO.USER.USER_EMAIL_CHANGE_INVALID_TOKEN,
  ],
  [
    'DELETE_CONFIRM_INVALID_TOKEN → 400',
    { type: 'DELETE_CONFIRM_INVALID_TOKEN' },
    400,
    INFO.USER.USER_DELETE_INVALID_TOKEN,
  ],

  // ── Moderation errors ──
  [
    'CONTENT_REPORT_NOT_FOUND → 404',
    { type: 'CONTENT_REPORT_NOT_FOUND', reportId: 'rep_1' },
    404,
    INFO.APPLICATION.NOT_FOUND,
  ],
  [
    'CONTENT_REPORT_ALREADY_RESOLVED → 400',
    { type: 'CONTENT_REPORT_ALREADY_RESOLVED', reportId: 'rep_1' },
    400,
    INFO.ADMIN.CANNOT_RESOLVE_REPORT,
  ],
  [
    'CONTENT_REPORT_RATE_LIMITED → 429',
    { type: 'CONTENT_REPORT_RATE_LIMITED', currentCount: 5, limit: 5 },
    429,
    INFO.GALLERY.REPORT_RATE_LIMITED,
  ],
  // duplicate fall-through ×2 → 400 CANNOT_REPORT_CONTENT.
  [
    'CONTENT_REPORT_DUPLICATE → 400',
    {
      type: 'CONTENT_REPORT_DUPLICATE',
      galleryRecordId: 'gr_1',
      reporterId: 'rp_1',
    },
    400,
    INFO.GALLERY.CANNOT_REPORT_CONTENT,
  ],
  [
    'CONTENT_REPORT_DUPLICATE_PENDING → 400',
    {
      type: 'CONTENT_REPORT_DUPLICATE_PENDING',
      galleryRecordId: 'gr_1',
      reporterId: 'rp_1',
    },
    400,
    INFO.GALLERY.CANNOT_REPORT_CONTENT,
  ],
  [
    'CONTENT_REPORT_SELF_REPORT → 403',
    {
      type: 'CONTENT_REPORT_SELF_REPORT',
      galleryRecordId: 'gr_1',
      reporterId: 'rp_1',
    },
    403,
    INFO.GALLERY.CONTENT_REPORT_SELF_REPORT,
  ],

  // ── Support errors ──
  // anti-enumeration: NOT_FOUND and NOT_AUTHORIZED MUST be byte-identical 404s.
  [
    'SUPPORT_THREAD_NOT_FOUND → 404',
    { type: 'SUPPORT_THREAD_NOT_FOUND', threadId: 'th_1' },
    404,
    INFO.SUPPORT.SUPPORT_THREAD_NOT_FOUND,
  ],
  [
    'SUPPORT_THREAD_NOT_AUTHORIZED → 404 (masked as NOT_FOUND)',
    { type: 'SUPPORT_THREAD_NOT_AUTHORIZED', threadId: 'th_1', userId: 'u_1' },
    404,
    INFO.SUPPORT.SUPPORT_THREAD_NOT_FOUND,
  ],
  [
    'SUPPORT_THREAD_CLOSED → 400',
    { type: 'SUPPORT_THREAD_CLOSED', threadId: 'th_1' },
    400,
    INFO.SUPPORT.SUPPORT_THREAD_CLOSED,
  ],

  // ── Newsletter errors ──
  [
    'ALREADY_SUBSCRIBED → 200 (success, anti-enumeration)',
    { type: 'ALREADY_SUBSCRIBED' },
    200,
    INFO.NEWSLETTER.NEWSLETTER_PENDING_CONFIRMATION,
  ],
  [
    'NEWSLETTER_INVALID_TOKEN → 400',
    { type: 'NEWSLETTER_INVALID_TOKEN' },
    400,
    INFO.NEWSLETTER.NEWSLETTER_INVALID_TOKEN,
  ],
  [
    'NEWSLETTER_UNSUBSCRIBE_NOT_FOUND → 404',
    { type: 'NEWSLETTER_UNSUBSCRIBE_NOT_FOUND' },
    404,
    INFO.NEWSLETTER.NEWSLETTER_UNSUBSCRIBE_NOT_FOUND,
  ],

  // ── SessionContainer errors ──
  [
    'SESSION_CONTAINER_NOT_FOUND → 404',
    { type: 'SESSION_CONTAINER_NOT_FOUND', sessionId: 'sc_1' },
    404,
    INFO.SESSION_CONTAINER.SESSION_CONTAINER_NOT_FOUND,
  ],
  [
    'SESSION_CONTAINER_NOT_AUTHORIZED → 403',
    {
      type: 'SESSION_CONTAINER_NOT_AUTHORIZED',
      sessionId: 'sc_1',
      userId: 'u_1',
    },
    403,
    INFO.SESSION_CONTAINER.SESSION_CONTAINER_NOT_AUTHORIZED,
  ],
  [
    'SESSION_CONTAINER_NOT_PAIRED → 403',
    {
      type: 'SESSION_CONTAINER_NOT_PAIRED',
      clientUserId: 'cu_1',
      stylistAccountId: 'sa_1',
    },
    403,
    INFO.SESSION_CONTAINER.SESSION_CONTAINER_NOT_PAIRED,
  ],
  [
    'SESSION_CONTAINER_MAX_ACTIVE_EXCEEDED → 429',
    {
      type: 'SESSION_CONTAINER_MAX_ACTIVE_EXCEEDED',
      clientAccountId: 'ca_1',
      currentCount: 3,
      limit: 3,
    },
    429,
    INFO.SESSION_CONTAINER.SESSION_CONTAINER_MAX_ACTIVE_EXCEEDED,
  ],
  [
    'SESSION_CONTAINER_INVALID_STATE → 400',
    {
      type: 'SESSION_CONTAINER_INVALID_STATE',
      sessionId: 'sc_1',
      currentState: 'CLOSED',
      attemptedAction: 'ADD_PHOTO',
    },
    400,
    INFO.SESSION_CONTAINER.SESSION_CONTAINER_INVALID_STATE,
  ],
  [
    'SESSION_CONTAINER_EMPTY → 400',
    { type: 'SESSION_CONTAINER_EMPTY', sessionId: 'sc_1' },
    400,
    INFO.SESSION_CONTAINER.SESSION_CONTAINER_EMPTY,
  ],
  [
    'SESSION_CONTAINER_PHOTO_OWNERSHIP → 403',
    {
      type: 'SESSION_CONTAINER_PHOTO_OWNERSHIP',
      sessionId: 'sc_1',
      galleryRecordId: 'gr_1',
      expectedStylistAccountId: 'sa_1',
    },
    403,
    INFO.SESSION_CONTAINER.SESSION_CONTAINER_PHOTO_OWNERSHIP,
  ],
  [
    'SESSION_CONTAINER_SHARE_QUOTA_EXCEEDED → 429',
    {
      type: 'SESSION_CONTAINER_SHARE_QUOTA_EXCEEDED',
      stylistAccountId: 'sa_1',
      currentCount: 10,
      limit: 10,
    },
    429,
    INFO.SESSION_CONTAINER.SESSION_CONTAINER_SHARE_QUOTA_EXCEEDED,
  ],
];

describe('mapErrorToResponse — golden-master status+event table', () => {
  it.each(ROWS)('%s', (_label, error, expectedStatus, expectedEvent) => {
    const { status, event } = runMapper(error);
    expect(status).toBe(expectedStatus);
    expect(event).toBe(expectedEvent);
  });

  it('covers every reachable switch case (table count is the golden number)', () => {
    // Tripwire: if a NEW DomainError variant is added to the union and wired into
    // the switch, this count won't match until a row is added above. Keep in lockstep
    // with the case labels in error-mapper.ts. (The `never` default branch + tsc
    // guarantee the switch handles the union; this guarantees the TABLE does too.)
    expect(ROWS.length).toBe(87);
  });

  it('the two anti-enumeration support errors are byte-for-byte identical (404 + same event)', () => {
    // SECURITY contract (see error-mapper.ts SUPPORT block): a thread that exists but
    // belongs to another user MUST be indistinguishable from a non-existent thread,
    // else 403-vs-404 leaks which thread ids are real (IDOR enumeration).
    const notFound = runMapper({
      type: 'SUPPORT_THREAD_NOT_FOUND',
      threadId: 'th_1',
    });
    const notAuthorized = runMapper({
      type: 'SUPPORT_THREAD_NOT_AUTHORIZED',
      threadId: 'th_1',
      userId: 'u_1',
    });
    expect(notAuthorized).toEqual(notFound);
  });
});
