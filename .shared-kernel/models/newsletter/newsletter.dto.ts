import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';

export type NEWSLETTER_DTO_API_V1 = {
  /** Zapisuje adres na newsletter z podwójnym potwierdzeniem: tworzy wpis oczekujący i wysyła mail potwierdzający. */
  NEWSLETTER_SUBSCRIBE: {
    REQUEST: { email: string; consentSource?: string };
    RESPONSE: { subscribed: true; pending_confirmation: true };
    RESPONSE_ERROR: DetailedErrorPayload<{
      email: string;
      consentSource?: string;
    }>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      NEWSLETTER_DTO_API_V1['NEWSLETTER_SUBSCRIBE']['REQUEST'],
      NEWSLETTER_DTO_API_V1['NEWSLETTER_SUBSCRIBE']['RESPONSE'],
      NEWSLETTER_DTO_API_V1['NEWSLETTER_SUBSCRIBE']['RESPONSE_ERROR']
    >;
  };

  /** Potwierdza zapis na newsletter tokenem z maila, idempotentnie; zwraca confirmed oraz already_confirmed przy ponownym kliknięciu. */
  NEWSLETTER_CONFIRM: {
    REQUEST: { token: string };
    RESPONSE: { confirmed: true; already_confirmed?: boolean };
    RESPONSE_ERROR: DetailedErrorPayload<{ token: string }>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      NEWSLETTER_DTO_API_V1['NEWSLETTER_CONFIRM']['REQUEST'],
      NEWSLETTER_DTO_API_V1['NEWSLETTER_CONFIRM']['RESPONSE'],
      NEWSLETTER_DTO_API_V1['NEWSLETTER_CONFIRM']['RESPONSE_ERROR']
    >;
  };

  /** Wypisuje adres z newslettera tokenem z maila, idempotentnie; zwraca already_unsubscribed przy powtórce. */
  NEWSLETTER_UNSUBSCRIBE: {
    REQUEST: { token: string };
    RESPONSE: { unsubscribed: true; already_unsubscribed?: boolean };
    RESPONSE_ERROR: DetailedErrorPayload<{ token: string }>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      NEWSLETTER_DTO_API_V1['NEWSLETTER_UNSUBSCRIBE']['REQUEST'],
      NEWSLETTER_DTO_API_V1['NEWSLETTER_UNSUBSCRIBE']['RESPONSE'],
      NEWSLETTER_DTO_API_V1['NEWSLETTER_UNSUBSCRIBE']['RESPONSE_ERROR']
    >;
  };
};
