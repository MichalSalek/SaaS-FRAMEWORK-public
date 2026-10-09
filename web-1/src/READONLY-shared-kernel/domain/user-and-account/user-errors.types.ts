export type UserNotFoundError = {
  type: 'USER_NOT_FOUND';
  userId: string;
};

export type UserEmailAlreadyInUseError = {
  type: 'USER_EMAIL_ALREADY_IN_USE';
  email: string;
};

export type ExportRateLimitedError = {
  type: 'EXPORT_RATE_LIMITED';
  lastExportAt: string;
  nextAvailableAt: string;
};

// Soft cancel design: user nie moze zdisable konta gdy ma aktywna Stripe sub —
// musi pierwej anulowac w Billing (intent split, prevents silent billing on inactive account).
// Active = ACTIVE, TRIALING, PAST_DUE, INCOMPLETE (wszystko gdzie Stripe billing leci).
export type UserHasActiveSubscriptionError = {
  type: 'USER_HAS_ACTIVE_SUBSCRIPTION';
  userId: string;
  subscriptionStatus: string;
};

// ADRR Model A: reactivation rejected because the account is not in the
// SOFT-DELETED/RECOVERABLE state (recovery_available=false). Covers EXPIRED
// (recovery window passed), ADMIN-DISABLED (ban), and ACTIVE/not-found rows.
// Idempotent guard `updateMany WHERE recovery_available=true` returns count=0.
export type AccountNotRecoverableError = {
  type: 'ACCOUNT_NOT_RECOVERABLE';
  userId: string;
};

export type UserError =
  | UserNotFoundError
  | UserEmailAlreadyInUseError
  | ExportRateLimitedError
  | UserHasActiveSubscriptionError
  | AccountNotRecoverableError;
