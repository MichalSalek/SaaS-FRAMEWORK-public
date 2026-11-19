// Common error types shared across all domains
// SSOT: Used by mapErrorToResponse() for exhaustive HTTP mapping

import type {
  AccountTypeValue,
  AccountStatus,
} from '../models/db_models.generated.dto';

export type AccountNotFoundError = {
  type: 'ACCOUNT_NOT_FOUND';
  accountId: string;
};

export type UnauthorizedError =
  | {
      type: 'UNAUTHORIZED';
      reason: 'MISSING_PERMISSION';
      requiredPermission: string;
    }
  | {
      type: 'UNAUTHORIZED';
      reason: 'WRONG_ACCOUNT_TYPE';
      requiredAccountType: (typeof AccountTypeValue)[keyof typeof AccountTypeValue];
    }
  | {
      type: 'UNAUTHORIZED';
      reason: 'ACCOUNT_INACTIVE';
      currentStatus: AccountStatus;
    }
  // DECISION: SESSION_EXPIRED is reserved capacity; no operation returns it today (Better Auth
  // answers an expired session with 401 directly). Kept in the union for a future app-layer wire-up.
  | { type: 'UNAUTHORIZED'; reason: 'SESSION_EXPIRED' };

export type ValidationError = {
  type: 'VALIDATION_ERROR';
  field: string;
  message: string;
};

// DECISION: `reason` is set only when the failure is attributable to the request (web-1
// `classifyQueryFailure`): UNIQUE_CONFLICT -> 409, REFERENCE_MISSING / INVALID_INPUT -> 400.
// Absent = genuine server fault -> opaque 500. Optional so existing `databaseFailure` call sites
// keep their type and no union member per class is needed.
export type DatabaseFailureReason =
  'UNIQUE_CONFLICT' | 'REFERENCE_MISSING' | 'INVALID_INPUT';

export type DatabaseError = {
  type: 'DATABASE_ERROR';
  operation: string;
  reason?: DatabaseFailureReason;
};

// DECISION: a Postgres 40001 (serializable abort) is a transient write-write race, not a server
// fault: the client should back off and retry, so it maps to 429 (error-mapper.ts) instead of
// DatabaseError 500. Domain-agnostic counterpart of the domain-specific retryable errors.
export type SerializationConflictError = {
  type: 'SERIALIZATION_CONFLICT';
};

export type ExternalServiceError = {
  type: 'EXTERNAL_SERVICE_ERROR';
  service: 'STRIPE' | 'S3' | 'CLOUDINARY' | 'MAILGUN';
  operation: string;
};

// DECISION: vendor-agnostic anti-bot failure (Cloudflare Turnstile today). It lives in COMMON errors
// because captcha gating is cross-domain. `reason` is a server-side diagnostic; the error-mapper
// returns 403 with a generic event and never echoes it, since the codes would tell a bot author
// which bypass attempt got furthest.
export type CaptchaVerificationFailedError = {
  type: 'CAPTCHA_VERIFICATION_FAILED';
  reason: string;
};

export type StylistNotFoundError = {
  type: 'STYLIST_NOT_FOUND';
  stylistAccountId: string;
};

export type AnnouncementNotFoundError = {
  type: 'ANNOUNCEMENT_NOT_FOUND';
  announcementId: string;
};

// DECISION: an infrastructure failure while resolving WHO is asking (Better Auth session read, the
// user row or its effective plan, a custom-role permission read) is neither "no session" (401) nor
// "not allowed" (403): both verdicts are false, a 401 LOGIN_FIRST makes the client delete a valid
// token. It maps to 503 AUTH_UNAVAILABLE + Retry-After and never grants access. `stage` is a
// server-side diagnostic only; the response does not echo it.
export type AuthUnavailableStage = 'SESSION' | 'USER' | 'PLAN' | 'PERMISSIONS';

export type AuthUnavailableError = {
  type: 'AUTH_UNAVAILABLE';
  stage: AuthUnavailableStage;
};

export type CommonError =
  | AuthUnavailableError
  | AccountNotFoundError
  | UnauthorizedError
  | ValidationError
  | DatabaseError
  | SerializationConflictError
  | ExternalServiceError
  | CaptchaVerificationFailedError
  | StylistNotFoundError
  | AnnouncementNotFoundError;
