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

// DECISION (nie usuwaj tego komentarza):
// EMAIL_SEND_FAILED removed from domain error union — was reserved for a future
// admin "resend" endpoint that never materialized. INFO event APP_EVENTS.INFO.EMAIL.EMAIL_SEND_FAILED
// is SEPARATE (it logs send failures, but does not propagate to client as a domain error).
// EMAIL_CHANGE_TOKEN_EXPIRED and DELETE_CONFIRM_TOKEN_EXPIRED removed: token TTL distinction
// not implemented; operations use single INVALID_TOKEN state for both not-found and expired.
// TTL distinction deferred to post-launch.
// EMAIL_ALREADY_UNSUBSCRIBED removed (finding email-newsletter-1): unsubscribe jest TERAZ
// idempotentny (re-klik poprawnego linku → success({already_unsubscribed:true}), nie 400),
// więc żadna operacja już nie produkuje tego błędu — typ był martwy + tworzył oracle
// 200-vs-400 ujawniający stan preferencji posiadaczowi tokena. Producent usunięty w
// email-unsubscribe.operations.ts.
// EMAIL_TRANSACTIONAL_NOT_UNSUBSCRIBABLE dodany (finding email-newsletter-2): żądanie
// wypisu z kategorii TRANSACTIONAL (brak preference key, PKE compliance) → honest 400
// zamiast mylącego success(unsubscribed:true) dla no-op.
export type EmailError =
  | EmailInvalidUnsubscribeTokenError
  | EmailUnsubscribeTokenExpiredError
  | EmailUserNotFoundError
  | EmailTransactionalNotUnsubscribableError
  | EmailChangeInvalidTokenError
  | DeleteConfirmInvalidTokenError;
