import type { DetailedErrorPayload } from '../../application/http/http.types';
import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { EmailCategory } from '../../domain/email/email-schedule.config';
import type {
  EmailInvalidUnsubscribeTokenError,
  EmailTransactionalNotUnsubscribableError,
  EmailUnsubscribeTokenExpiredError,
} from '../../domain/email/email-errors.types';
import type {
  TrialEmailRule,
  CancelEmailRule,
} from '../../domain/email/email-schedule.types';
import type { EVENT_INFO_TYPE } from '../../domain/commands-and-queries/cqrs.types';

export type EmailPreferences = {
  trial_sequence: boolean;
  marketing: boolean;
  // transactional is ALWAYS true (cannot unsubscribe — PKE compliance)
};

/**
 * Default email preferences for new accounts.
 * SSOT — used by domain resolvers, operations, and interceptor.
 */
export const DEFAULT_EMAIL_PREFERENCES: EmailPreferences = {
  trial_sequence: true,
  marketing: false,
};

export type EMAIL_DTO_API_V1 = {
  /** Wypisuje odbiorcę z kategorii maili na podstawie tokenu z linku wypisu; zwraca odpiętą kategorię (transakcyjnych wypisać nie można). */
  EMAIL_UNSUBSCRIBE: {
    REQUEST: { token: string };
    // already_unsubscribed: the category was already off (idempotent repeat),
    // mirroring NEWSLETTER_UNSUBSCRIBE. A token that cannot unsubscribe answers
    // with the second RESPONSE_ERROR shape (the page maps `error` to its copy).
    RESPONSE: {
      unsubscribed: true;
      category: EmailCategory;
      already_unsubscribed: boolean;
    };
    RESPONSE_ERROR:
      | DetailedErrorPayload<{ token: string }>
      | {
          unsubscribed: false;
          error:
            | EmailInvalidUnsubscribeTokenError['type']
            | EmailUnsubscribeTokenExpiredError['type']
            | EmailTransactionalNotUnsubscribableError['type'];
        };
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      EMAIL_DTO_API_V1['EMAIL_UNSUBSCRIBE']['REQUEST'],
      EMAIL_DTO_API_V1['EMAIL_UNSUBSCRIBE']['RESPONSE'],
      EMAIL_DTO_API_V1['EMAIL_UNSUBSCRIBE']['RESPONSE_ERROR']
    >;
  };

  /** Zwraca konfigurację harmonogramu maili: reguły czasowe sekwencji trialu oraz sekwencji po anulowaniu. */
  EMAIL_GET_SCHEDULE: {
    REQUEST: Record<string, never>;
    RESPONSE: {
      schedule: readonly TrialEmailRule[];
      cancelSchedule: readonly CancelEmailRule[];
    };
    RESPONSE_ERROR: DetailedErrorPayload<Record<string, never>>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      EMAIL_DTO_API_V1['EMAIL_GET_SCHEDULE']['REQUEST'],
      EMAIL_DTO_API_V1['EMAIL_GET_SCHEDULE']['RESPONSE'],
      EMAIL_DTO_API_V1['EMAIL_GET_SCHEDULE']['RESPONSE_ERROR']
    >;
  };

  /** Zwraca stronicowaną historię wysłanych maili użytkownika (cursor, take); admin może podejrzeć cudzą przez userId. */
  EMAIL_GET_HISTORY: {
    REQUEST: { cursor?: string; take?: number } | Record<string, never>;
    RESPONSE: {
      emails: Array<{
        event_log_id: string;
        event: EVENT_INFO_TYPE;
        sentAt: string;
        category: EmailCategory | 'UNKNOWN';
      }>;
      nextCursor: string | null;
    };
    RESPONSE_ERROR: DetailedErrorPayload<Record<string, never>>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      EMAIL_DTO_API_V1['EMAIL_GET_HISTORY']['REQUEST'],
      EMAIL_DTO_API_V1['EMAIL_GET_HISTORY']['RESPONSE'],
      EMAIL_DTO_API_V1['EMAIL_GET_HISTORY']['RESPONSE_ERROR']
    >;
  };

  /** Zapisuje preferencje mailowe zalogowanego użytkownika (sekwencja trialu, marketing); zwraca zaktualizowany zestaw. */
  EMAIL_UPDATE_PREFERENCES: {
    REQUEST: { trial_sequence: boolean; marketing: boolean };
    RESPONSE: { preferences: EmailPreferences };
    RESPONSE_ERROR: DetailedErrorPayload<{
      trial_sequence: string;
      marketing: string;
    }>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      EMAIL_DTO_API_V1['EMAIL_UPDATE_PREFERENCES']['REQUEST'],
      EMAIL_DTO_API_V1['EMAIL_UPDATE_PREFERENCES']['RESPONSE'],
      EMAIL_DTO_API_V1['EMAIL_UPDATE_PREFERENCES']['RESPONSE_ERROR']
    >;
  };
};
