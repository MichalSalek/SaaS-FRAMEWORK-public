import type { EmailCategory } from './email-schedule.config';

export type EmailInvalidUnsubscribeTokenError = {
  type: 'EMAIL_INVALID_UNSUBSCRIBE_TOKEN';
};

export type EmailUnsubscribeTokenExpiredError = {
  type: 'EMAIL_UNSUBSCRIBE_TOKEN_EXPIRED';
};

export type EmailUserNotFoundError = {
  type: 'EMAIL_USER_NOT_FOUND';
  userId: string;
};

export type EmailTransactionalNotUnsubscribableError = {
  type: 'EMAIL_TRANSACTIONAL_NOT_UNSUBSCRIBABLE';
  category: EmailCategory;
};

export type EmailChangeInvalidTokenError = {
  type: 'EMAIL_CHANGE_INVALID_TOKEN';
};

export type DeleteConfirmInvalidTokenError = {
  type: 'DELETE_CONFIRM_INVALID_TOKEN';
};

// DECISION: a repeated unsubscribe returns success({already_unsubscribed:true}), so
// there is no EMAIL_ALREADY_UNSUBSCRIBED error: a 200-vs-400 split would reveal preference state to
// the token holder. Token expiry has no separate error either (operations use one INVALID_TOKEN
// state), and EMAIL_SEND_FAILED exists only as an INFO event, never as a domain error.
// Test: web-1/src/domain/email/operations/email-preferences.lifecycle.test.ts (covers a repeated
// unsubscribe link returning already_unsubscribed; not concurrent clicks).
export type EmailError =
  | EmailInvalidUnsubscribeTokenError
  | EmailUnsubscribeTokenExpiredError
  | EmailUserNotFoundError
  | EmailTransactionalNotUnsubscribableError
  | EmailChangeInvalidTokenError
  | DeleteConfirmInvalidTokenError;
