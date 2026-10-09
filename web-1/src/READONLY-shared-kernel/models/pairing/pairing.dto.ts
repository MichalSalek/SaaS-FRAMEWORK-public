import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';
import type {
  ClientStylistPair,
  PairingSession,
  User,
  StylistAccount,
} from '../db_models.generated.dto';

export type PAIRING_DTO_API_V1 = {
  /** Stylistka wystawia efemeryczną sesję parowania (token + czas wygaśnięcia) do połączenia z klientką. */
  PAIRING_SESSION_ISSUE: {
    REQUEST: undefined;
    RESPONSE: {
      token: PairingSession['token'];
      expires_at: string; // wire format (JSON-serialized Date)
      stylist_account_id: PairingSession['stylist_account_id'];
    };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      PAIRING_DTO_API_V1['PAIRING_SESSION_ISSUE']['REQUEST'],
      PAIRING_DTO_API_V1['PAIRING_SESSION_ISSUE']['RESPONSE'],
      PAIRING_DTO_API_V1['PAIRING_SESSION_ISSUE']['RESPONSE_ERROR']
    >;
  };

  /** Klientka realizuje token sesji parowania i łączy konto ze stylistką (zwraca nazwę wyświetlaną). */
  PAIRING_SESSION_CLAIM: {
    REQUEST: Pick<PairingSession, 'token'>;
    RESPONSE: {
      success: boolean;
      stylist_account_id: StylistAccount['account_id'];
      display_name: StylistAccount['display_name'];
      message: string;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      PAIRING_DTO_API_V1['PAIRING_SESSION_CLAIM']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      PAIRING_DTO_API_V1['PAIRING_SESSION_CLAIM']['REQUEST'],
      PAIRING_DTO_API_V1['PAIRING_SESSION_CLAIM']['RESPONSE'],
      PAIRING_DTO_API_V1['PAIRING_SESSION_CLAIM']['RESPONSE_ERROR']
    >;
  };

  /** Stylistka unieważnia pojedynczą sesję parowania wskazaną tokenem. */
  PAIRING_SESSION_REVOKE: {
    REQUEST: Pick<PairingSession, 'token'>;
    RESPONSE: {
      success: boolean;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      PAIRING_DTO_API_V1['PAIRING_SESSION_REVOKE']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      PAIRING_DTO_API_V1['PAIRING_SESSION_REVOKE']['REQUEST'],
      PAIRING_DTO_API_V1['PAIRING_SESSION_REVOKE']['RESPONSE'],
      PAIRING_DTO_API_V1['PAIRING_SESSION_REVOKE']['RESPONSE_ERROR']
    >;
  };

  /** Stylistka unieważnia wszystkie swoje aktywne sesje parowania, zwraca liczbę cofniętych. */
  PAIRING_SESSION_REVOKE_ALL: {
    REQUEST: undefined;
    RESPONSE: {
      revoked_count: number;
    };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      PAIRING_DTO_API_V1['PAIRING_SESSION_REVOKE_ALL']['REQUEST'],
      PAIRING_DTO_API_V1['PAIRING_SESSION_REVOKE_ALL']['RESPONSE'],
      PAIRING_DTO_API_V1['PAIRING_SESSION_REVOKE_ALL']['RESPONSE_ERROR']
    >;
  };

  /** Zrywa istniejące połączenie klientka·stylistka i cofa wzajemny dostęp (cel po id usera lub konta). */
  PAIRING_ACCESS_REVOKE: {
    REQUEST: {
      target_user_id?: User['id'];
      target_account_id?: StylistAccount['account_id'];
    };
    RESPONSE: {
      success: boolean;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      PAIRING_DTO_API_V1['PAIRING_ACCESS_REVOKE']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      PAIRING_DTO_API_V1['PAIRING_ACCESS_REVOKE']['REQUEST'],
      PAIRING_DTO_API_V1['PAIRING_ACCESS_REVOKE']['RESPONSE'],
      PAIRING_DTO_API_V1['PAIRING_ACCESS_REVOKE']['RESPONSE_ERROR']
    >;
  };

  /** Zwraca status dostępu klientki do profilu stylistki (PUBLIC, PAIRED albo PENDING) z datą sparowania. */
  PAIRING_GET_ACCESS_STATUS: {
    REQUEST: {
      stylist_account_id: StylistAccount['account_id'];
    };
    RESPONSE: {
      // PENDING (2026-07-11, stały QR): prośba klientki czeka na akceptację
      // stylistki — profil pokazuje stan zamiast ponownego przycisku prośby.
      access: 'PUBLIC' | 'PAIRED' | 'PENDING';
      paired_at?: string;
      // Id pary (PENDING/PAIRED) — klucz dla „anuluj prośbę" + wejścia do
      // komunikatora z profilu (O1). Brak przy PUBLIC.
      pair_id?: ClientStylistPair['id'];
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      PAIRING_DTO_API_V1['PAIRING_GET_ACCESS_STATUS']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      PAIRING_DTO_API_V1['PAIRING_GET_ACCESS_STATUS']['REQUEST'],
      PAIRING_DTO_API_V1['PAIRING_GET_ACCESS_STATUS']['RESPONSE'],
      PAIRING_DTO_API_V1['PAIRING_GET_ACCESS_STATUS']['RESPONSE_ERROR']
    >;
  };

  // Stały kod QR = tożsamość profilu (PAIRING_QR_ARCHITECTURE_BRAINSTORM,
  // wdrożenie 2026-07-11): klientka prosi o połączenie z publicznego profilu
  // → para PENDING (żadnego dostępu) → stylistka akceptuje 1 tapem.
  PAIR_REQUEST_CREATE: {
    REQUEST: {
      stylist_account_id: StylistAccount['account_id'];
    };
    RESPONSE: {
      // ALREADY_PAIRED = idempotentny sukces przy istniejącej ACTIVE parze
      // (klientka skanuje plakat salonu, z którym już jest połączona).
      status: 'PENDING' | 'ALREADY_PAIRED';
      display_name: StylistAccount['display_name'];
      // true tylko przy realnym utworzeniu prośby — liczniki lejka (audyt +
      // PostHog) liczą wyłącznie created, idempotentny re-POST nie pompuje.
      created: boolean;
      // Id pary = wspólny klucz lejka PostHog (sent → accepted/declined po
      // OBU stronach; bez niego eventy różnych userów były niezłączalne —
      // Codex S51). null tylko na przegranym P2002-wyścigu pierwszych próśb.
      pair_id: ClientStylistPair['id'] | null;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      PAIRING_DTO_API_V1['PAIR_REQUEST_CREATE']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      PAIRING_DTO_API_V1['PAIR_REQUEST_CREATE']['REQUEST'],
      PAIRING_DTO_API_V1['PAIR_REQUEST_CREATE']['RESPONSE'],
      PAIRING_DTO_API_V1['PAIR_REQUEST_CREATE']['RESPONSE_ERROR']
    >;
  };

  /** Stylistka akceptuje (PENDING na ACTIVE) albo odrzuca prośbę klientki o połączenie. */
  PAIR_REQUEST_RESPOND: {
    REQUEST: {
      pair_id: ClientStylistPair['id'];
      action: 'ACCEPT' | 'DECLINE';
    };
    RESPONSE: {
      success: boolean;
      status: 'ACTIVE' | 'DECLINED';
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      PAIRING_DTO_API_V1['PAIR_REQUEST_RESPOND']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      PAIRING_DTO_API_V1['PAIR_REQUEST_RESPOND']['REQUEST'],
      PAIRING_DTO_API_V1['PAIR_REQUEST_RESPOND']['RESPONSE'],
      PAIRING_DTO_API_V1['PAIR_REQUEST_RESPOND']['RESPONSE_ERROR']
    >;
  };

  /** Klientka wycofuje WŁASNĄ prośbę PENDING o połączenie (O1) — para -> REVOKED. */
  PAIR_REQUEST_CANCEL: {
    REQUEST: {
      stylist_account_id: StylistAccount['account_id'];
    };
    RESPONSE: {
      success: boolean;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      PAIRING_DTO_API_V1['PAIR_REQUEST_CANCEL']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      PAIRING_DTO_API_V1['PAIR_REQUEST_CANCEL']['REQUEST'],
      PAIRING_DTO_API_V1['PAIR_REQUEST_CANCEL']['RESPONSE'],
      PAIRING_DTO_API_V1['PAIR_REQUEST_CANCEL']['RESPONSE_ERROR']
    >;
  };

  /** Zwraca stylistce listę oczekujących próśb o połączenie (imię klientki i czas prośby). */
  PAIRING_GET_PENDING_REQUESTS: {
    REQUEST: undefined;
    RESPONSE: {
      // PII-minimum przed akceptacją: samo imię (email klientki dopiero po
      // ACCEPT — w get-my-pairs). requested_at = paired_at wiersza PENDING.
      requests: Array<{
        pair_id: ClientStylistPair['id'];
        name: User['name'];
        requested_at: string; // wire format (JSON-serialized Date)
      }>;
    };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      PAIRING_DTO_API_V1['PAIRING_GET_PENDING_REQUESTS']['REQUEST'],
      PAIRING_DTO_API_V1['PAIRING_GET_PENDING_REQUESTS']['RESPONSE'],
      PAIRING_DTO_API_V1['PAIRING_GET_PENDING_REQUESTS']['RESPONSE_ERROR']
    >;
  };

  /** Stronicowana lista aktywnych par bieżącego konta (klientka widzi salony, stylistka klientki).
   *  D1 (2026-09-05): para z kontrpartnerem o nieaktywnym koncie (soft-delete w oknie
   *  90 dni albo ban) NADAL liczy się do limitu i dlatego JEST na liście jako
   *  „Konto nieaktywne": `counterpart_inactive=true`, tożsamość ZAMASKOWANA po
   *  stronie serwera (pola nazwy/e-maila/miasta/avatara puste), identyfikatory
   *  zostają, bo napędzają akcję „Zwolnij miejsce" (revoke-access). */
  PAIRING_GET_MY_PAIRS: {
    REQUEST: { cursor?: string; take?: number } | undefined;
    RESPONSE: {
      pairs: Array<
        | {
            /** ClientStylistPair.id — klucz wątku komunikatora (MESSAGES_THREAD).
             *  Backend mapował go od zawsze (id: p.id); zadeklarowany w DTO od
             *  S76, żeby UI mogło linkować „Napisz wiadomość" z list par. */
            id: string;
            user_id: User['id'];
            name: User['name'];
            email: User['email'];
            paired_at: string; // wire format
            /** D1: konto klientki nieaktywne — wiersz zamaskowany, bez wejścia w kartę. */
            counterpart_inactive: boolean;
          }
        | {
            /** ClientStylistPair.id — patrz wariant klientki wyżej. */
            id: string;
            account_id: StylistAccount['account_id'];
            display_name: StylistAccount['display_name'];
            business_name: StylistAccount['business_name'];
            address_city: StylistAccount['address_city'];
            avatar_url: string | null;
            paired_at: string; // wire format
            /** D1: konto stylistki nieaktywne — wiersz zamaskowany, bez wejścia w profil. */
            counterpart_inactive: boolean;
          }
      >;
      nextCursor: string | null;
    };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      PAIRING_DTO_API_V1['PAIRING_GET_MY_PAIRS']['REQUEST'],
      PAIRING_DTO_API_V1['PAIRING_GET_MY_PAIRS']['RESPONSE'],
      PAIRING_DTO_API_V1['PAIRING_GET_MY_PAIRS']['RESPONSE_ERROR']
    >;
  };
};
