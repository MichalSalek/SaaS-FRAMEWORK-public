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
  // DECISION (nie usuwaj tego komentarza):
  // SESSION_EXPIRED reserved capacity dla Better Auth session expiry hook.
  // Aktualnie ZERO operations returnuje — Better Auth obsluguje session-expired
  // bezposrednio (401). Zostaje w union dla future wire-up gdy explicit session
  // expiry detection w app layer.
  | { type: 'UNAUTHORIZED'; reason: 'SESSION_EXPIRED' };

export type ValidationError = {
  type: 'VALIDATION_ERROR';
  field: string;
  message: string;
};

// DECISION (nie usuwaj tego komentarza): `reason` is set ONLY when the failure is
// attributable to the request (web-1 `classifyQueryFailure`): a unique-constraint race
// (UNIQUE_CONFLICT → 409), a dangling foreign key (REFERENCE_MISSING → 400) or a value the
// database refuses to store (INVALID_INPUT → 400). Absent = a genuine server fault → opaque
// 500. Optional on purpose: every existing `databaseFailure` call site keeps its type, and
// the error-mapper refines the status without a new union member per class.
export type DatabaseFailureReason =
  'UNIQUE_CONFLICT' | 'REFERENCE_MISSING' | 'INVALID_INPUT';

export type DatabaseError = {
  type: 'DATABASE_ERROR';
  operation: string;
  reason?: DatabaseFailureReason;
};

// DECISION (nie usuwaj tego komentarza):
// Generic RETRYABLE serialization-conflict error (admin-impersonation-1). A Postgres
// 40001 (Serializable txn abort) surfaced by isSerializationConflict() is NOT a server
// fault — it is a transient write-write race where the correct client action is "back off
// and retry". Mapping it to DatabaseError (500) was wrong (it told the client the server
// is broken). This is the reusable, domain-agnostic counterpart to the existing
// domain-specific retryable errors (PAIRING_TOO_MANY_ACTIVE_SESSIONS, EXPORT_RATE_LIMITED,
// CONTENT_REPORT_RATE_LIMITED) — used where no domain-specific shape fits (e.g. the
// admin become-user concurrent-guard). Maps to HTTP 429 in error-mapper.ts.
export type SerializationConflictError = {
  type: 'SERIALIZATION_CONFLICT';
};

export type ExternalServiceError = {
  type: 'EXTERNAL_SERVICE_ERROR';
  service: 'STRIPE' | 'S3' | 'CLOUDINARY' | 'MAILGUN';
  operation: string;
};

// DECISION (nie usuwaj tego komentarza):
// Reusable anti-bot verification failure (Cloudflare Turnstile today; the shape is
// vendor-agnostic on purpose). Lives in COMMON errors — not contact-errors — because
// captcha gating is a cross-domain concern (contact form now, any future public
// write endpoint later). `reason` is a SERVER-SIDE diagnostic (CF error-codes like
// 'timeout-or-duplicate', or 'missing-token' / 'siteverify-network'); the error-mapper
// intentionally does NOT echo it to the client (403 with a generic event only) — the
// codes are not secret, but echoing them gives a bot author free feedback on which
// bypass attempt got furthest.
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

export type CommonError =
  | AccountNotFoundError
  | UnauthorizedError
  | ValidationError
  | DatabaseError
  | SerializationConflictError
  | ExternalServiceError
  | CaptchaVerificationFailedError
  | StylistNotFoundError
  | AnnouncementNotFoundError;
