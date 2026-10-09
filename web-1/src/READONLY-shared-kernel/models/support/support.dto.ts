import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';
import type {
  SupportThreadStatus,
  SupportSenderType,
  SupportThreadCategory,
} from '../db_models.generated.dto';

// DECISION (nie usuwaj tego komentarza):
// Support enumy = Prisma-generated SSOT (db_models.generated.dto). Usunięto ręczne
// SUPPORT_THREAD_STATUSES / SUPPORT_SENDER_TYPES / SupportThreadStatus (B10 — był podwójny
// SSOT z odwróconym nazewnictwem). Konwencja generated: `*Value` = obiekt runtime,
// bez sufiksu = typ union. Listę stałych daje Object.values(SupportThreadStatusValue).
// Wartości identyczne (OPEN/RESOLVED/CLOSED, USER/SUPPORT) — refactor type-only.
export {
  SupportThreadStatusValue,
  SupportSenderTypeValue,
  SupportThreadCategoryValue,
} from '../db_models.generated.dto';
export type {
  SupportThreadStatus,
  SupportSenderType,
  SupportThreadCategory,
} from '../db_models.generated.dto';

/**
 * Admin list filter value for threads WITHOUT a category (created before
 * categories existed, `category` is null). Not a member of the enum on purpose:
 * it never reaches the database column.
 */
export const SUPPORT_CATEGORY_FILTER_NONE = 'NONE';
export type SupportThreadCategoryFilter =
  SupportThreadCategory | typeof SUPPORT_CATEGORY_FILTER_NONE;

export type SupportMessageDTO = {
  id: string;
  thread_id: string;
  sender_type: SupportSenderType;
  content: string;
  created_at: string | Date;
};

/** Fields every thread list row carries, on the user side and the admin side. */
type SupportThreadListItemBase = {
  id: string;
  /** Title of the thread. Derived by the server from the first message (S126). */
  subject: string;
  /** null = a thread created before categories existed. */
  category: SupportThreadCategory | null;
  status: SupportThreadStatus;
  created_at: string | Date;
  updated_at: string | Date;
  last_message_preview: string | null;
  last_message_sender_type: SupportSenderType | null;
  message_count: number;
};

export type SupportThreadListItem = SupportThreadListItemBase & {
  /**
   * A SUPPORT message newer than the owner's read marker exists
   * (SupportThread.user_last_read_at). Same rule as SUPPORT_GET_UNREAD_COUNT.
   */
  has_unread_reply: boolean;
};

// The admin row deliberately has NO `has_unread_reply`: the marker describes
// what the OWNER has read, and the admin queue is driven by "awaiting reply".
export type SupportThreadAdminListItem = SupportThreadListItemBase & {
  user_email: string;
  user_name: string;
};

export type SUPPORT_DTO_API_V1 = {
  /** Zakłada nowy wątek wsparcia (kategoria + pierwsza wiadomość) w imieniu zalogowanego użytkownika; temat wylicza serwer z treści. Zwraca thread_id. */
  SUPPORT_CREATE_THREAD: {
    REQUEST: {
      category: SupportThreadCategory;
      message: string;
    };
    RESPONSE: {
      thread_id: string;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      SUPPORT_DTO_API_V1['SUPPORT_CREATE_THREAD']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SUPPORT_DTO_API_V1['SUPPORT_CREATE_THREAD']['REQUEST'],
      SUPPORT_DTO_API_V1['SUPPORT_CREATE_THREAD']['RESPONSE'],
      SUPPORT_DTO_API_V1['SUPPORT_CREATE_THREAD']['RESPONSE_ERROR']
    >;
  };

  /** Dopisuje wiadomość zalogowanego użytkownika do istniejącego wątku wsparcia po thread_id; zwraca message_id. */
  SUPPORT_ADD_MESSAGE: {
    REQUEST: {
      thread_id: string;
      content: string;
    };
    RESPONSE: {
      message_id: string;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      SUPPORT_DTO_API_V1['SUPPORT_ADD_MESSAGE']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SUPPORT_DTO_API_V1['SUPPORT_ADD_MESSAGE']['REQUEST'],
      SUPPORT_DTO_API_V1['SUPPORT_ADD_MESSAGE']['RESPONSE'],
      SUPPORT_DTO_API_V1['SUPPORT_ADD_MESSAGE']['RESPONSE_ERROR']
    >;
  };

  /** Lista własnych wątków wsparcia zalogowanego użytkownika ze stronicowaniem kursorowym (cursor, take). */
  SUPPORT_GET_MY_THREADS: {
    REQUEST: { cursor?: string; take?: number } | Record<string, never>;
    RESPONSE: {
      threads: SupportThreadListItem[];
      nextCursor: string | null;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      SUPPORT_DTO_API_V1['SUPPORT_GET_MY_THREADS']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SUPPORT_DTO_API_V1['SUPPORT_GET_MY_THREADS']['REQUEST'],
      SUPPORT_DTO_API_V1['SUPPORT_GET_MY_THREADS']['RESPONSE'],
      SUPPORT_DTO_API_V1['SUPPORT_GET_MY_THREADS']['RESPONSE_ERROR']
    >;
  };

  /** Zwraca wiadomości oraz nagłówek (temat, status) jednego wątku wsparcia użytkownika po thread_id. */
  SUPPORT_GET_THREAD_MESSAGES: {
    REQUEST: {
      thread_id: string;
    };
    RESPONSE: {
      messages: SupportMessageDTO[];
      thread: {
        id: string;
        subject: string;
        category: SupportThreadCategory | null;
        status: SupportThreadStatus;
      };
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      SUPPORT_DTO_API_V1['SUPPORT_GET_THREAD_MESSAGES']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SUPPORT_DTO_API_V1['SUPPORT_GET_THREAD_MESSAGES']['REQUEST'],
      SUPPORT_DTO_API_V1['SUPPORT_GET_THREAD_MESSAGES']['RESPONSE'],
      SUPPORT_DTO_API_V1['SUPPORT_GET_THREAD_MESSAGES']['RESPONSE_ERROR']
    >;
  };

  /** Liczba własnych wątków wsparcia z odpowiedzią, której zalogowany użytkownik jeszcze nie otworzył (badge). */
  SUPPORT_GET_UNREAD_COUNT: {
    REQUEST: undefined;
    RESPONSE: {
      unread_threads: number;
    };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SUPPORT_DTO_API_V1['SUPPORT_GET_UNREAD_COUNT']['REQUEST'],
      SUPPORT_DTO_API_V1['SUPPORT_GET_UNREAD_COUNT']['RESPONSE'],
      SUPPORT_DTO_API_V1['SUPPORT_GET_UNREAD_COUNT']['RESPONSE_ERROR']
    >;
  };

  /** Oznacza własny wątek wsparcia jako przeczytany (znacznik = teraz); cudzy albo nieistniejący wątek = 404. */
  SUPPORT_MARK_THREAD_READ: {
    REQUEST: {
      thread_id: string;
    };
    RESPONSE: {
      thread_id: string;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      SUPPORT_DTO_API_V1['SUPPORT_MARK_THREAD_READ']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SUPPORT_DTO_API_V1['SUPPORT_MARK_THREAD_READ']['REQUEST'],
      SUPPORT_DTO_API_V1['SUPPORT_MARK_THREAD_READ']['RESPONSE'],
      SUPPORT_DTO_API_V1['SUPPORT_MARK_THREAD_READ']['RESPONSE_ERROR']
    >;
  };

  /** Widok admina: lista wszystkich wątków wsparcia z adresem i nazwą użytkownika; filtry po statusie, kategorii i „czeka na odpowiedź”, kursor. */
  SUPPORT_ADMIN_GET_ALL_THREADS: {
    REQUEST: {
      status?: SupportThreadStatus;
      /** One category, or `NONE` for threads created before categories existed. */
      category?: SupportThreadCategoryFilter;
      /**
       * true = exactly the threads counted by the admin badge
       * `support_awaiting_reply` (OPEN and the latest message is from the user).
       * The `status` filter is ignored then: the predicate already fixes it.
       */
      awaiting_reply?: boolean;
      cursor?: string;
      take?: number;
    };
    RESPONSE: {
      threads: SupportThreadAdminListItem[];
      nextCursor: string | null;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      SUPPORT_DTO_API_V1['SUPPORT_ADMIN_GET_ALL_THREADS']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SUPPORT_DTO_API_V1['SUPPORT_ADMIN_GET_ALL_THREADS']['REQUEST'],
      SUPPORT_DTO_API_V1['SUPPORT_ADMIN_GET_ALL_THREADS']['RESPONSE'],
      SUPPORT_DTO_API_V1['SUPPORT_ADMIN_GET_ALL_THREADS']['RESPONSE_ERROR']
    >;
  };

  /** Widok admina: wiadomości i nagłówek wątku plus thread.updated_at jako token optymistycznej współbieżności. */
  SUPPORT_ADMIN_GET_THREAD_MESSAGES: {
    REQUEST: SUPPORT_DTO_API_V1['SUPPORT_GET_THREAD_MESSAGES']['REQUEST'];
    // Rozszerza user-owa RESPONSE o thread.updated_at — token optimistic-concurrency
    // (finding support-1): admin UI odsyla go jako CHANGE_STATUS.expected_updated_at,
    // dzieki czemu stale close (user odpisal po zaladowaniu widoku) dostaje 409.
    // Oraz o tozsamosc autora: LISTA watkow (SupportThreadAdminListItem) niosla
    // user_name/user_email od zawsze, a szczegol nie — wiec operator widzial nazwisko
    // na liscie i "Klient" po wejsciu w ten sam watek. Soft-FK (user mogl zostac
    // usuniety/przeniesiony) => pusty string, tak samo jak w liscie.
    RESPONSE: SUPPORT_DTO_API_V1['SUPPORT_GET_THREAD_MESSAGES']['RESPONSE'] & {
      thread: SUPPORT_DTO_API_V1['SUPPORT_GET_THREAD_MESSAGES']['RESPONSE']['thread'] & {
        updated_at: string | Date;
        user_email: string;
        user_name: string;
      };
    };
    RESPONSE_ERROR: SUPPORT_DTO_API_V1['SUPPORT_GET_THREAD_MESSAGES']['RESPONSE_ERROR'];
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SUPPORT_DTO_API_V1['SUPPORT_ADMIN_GET_THREAD_MESSAGES']['REQUEST'],
      SUPPORT_DTO_API_V1['SUPPORT_ADMIN_GET_THREAD_MESSAGES']['RESPONSE'],
      SUPPORT_DTO_API_V1['SUPPORT_ADMIN_GET_THREAD_MESSAGES']['RESPONSE_ERROR']
    >;
  };

  /** Odpowiedź admina w wątku wsparcia (thread_id + treść); wysyła powiadomienie do użytkownika, zwraca message_id. */
  SUPPORT_ADMIN_REPLY: {
    REQUEST: {
      thread_id: string;
      content: string;
    };
    RESPONSE: {
      message_id: string;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      SUPPORT_DTO_API_V1['SUPPORT_ADMIN_REPLY']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SUPPORT_DTO_API_V1['SUPPORT_ADMIN_REPLY']['REQUEST'],
      SUPPORT_DTO_API_V1['SUPPORT_ADMIN_REPLY']['RESPONSE'],
      SUPPORT_DTO_API_V1['SUPPORT_ADMIN_REPLY']['RESPONSE_ERROR']
    >;
  };

  /** Admin zmienia status wątku (OPEN/RESOLVED/CLOSED); expected_updated_at chroni przed nadpisaniem świeżej odpowiedzi (409). */
  SUPPORT_CHANGE_STATUS: {
    REQUEST: {
      thread_id: string;
      status: SupportThreadStatus;
      // Optimistic-concurrency (finding support-1): admin declares the thread state it
      // last saw (updated_at). Operation does updateMany WHERE updated_at = expected; a
      // fresh user reply that bumped updated_at => 0 rows => stale-close rejected, thread
      // stays OPEN. Optional: when absent, status change is unconditional (legacy/no-guard).
      // ISO 8601 datetime string (or Date). No schema migration — updated_at already exists.
      // null akceptowany (JSON null z klienta) — walidator/operacja traktuja null===absent (unconditional).
      expected_updated_at?: string | Date | null;
    };
    RESPONSE: {
      thread_id: string;
      status: SupportThreadStatus;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      SUPPORT_DTO_API_V1['SUPPORT_CHANGE_STATUS']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SUPPORT_DTO_API_V1['SUPPORT_CHANGE_STATUS']['REQUEST'],
      SUPPORT_DTO_API_V1['SUPPORT_CHANGE_STATUS']['RESPONSE'],
      SUPPORT_DTO_API_V1['SUPPORT_CHANGE_STATUS']['RESPONSE_ERROR']
    >;
  };
};
