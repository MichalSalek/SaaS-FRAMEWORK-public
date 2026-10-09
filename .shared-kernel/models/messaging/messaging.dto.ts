import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';
import type {
  StylistClientMessageSender,
  PairingStatus,
} from '../db_models.generated.dto';

// Enum runtime + typ = Prisma-generated SSOT (konwencja: `*Value` = obiekt, bez
// sufiksu = union). Re-export dla konsumentów DTO (front selektory / gating).
export { StylistClientMessageSenderValue } from '../db_models.generated.dto';
export type { StylistClientMessageSender } from '../db_models.generated.dto';

/** Pojedyncza wiadomość w wątku. */
export type MessagingMessageDTO = {
  id: string;
  sender_type: StylistClientMessageSender;
  content: string;
  created_at: string | Date;
};

/** Metadane wątku (nagłówek rozmowy) — kto jest rozmówcą + czy można pisać. */
export type MessagingThreadMeta = {
  pair_id: string;
  status: PairingStatus;
  /** Nazwa drugiej strony (klientki albo stylistki) z perspektywy wołającego. */
  counterpart_name: string;
  counterpart_avatar_url: string | null;
  /** Strona wołającego w TEJ parze (STYLIST albo CLIENT). */
  viewer_side: StylistClientMessageSender;
  /** Wysyłka dozwolona (para PENDING/ACTIVE). REVOKED = read-only. */
  can_send: boolean;
  /** D2: znacznik ukrycia rozmowy PO STRONIE WOŁAJĄCEGO (null = widoczna). */
  hidden_at: string | Date | null;
};

/** Wiersz listy rozmów (inbox). */
export type MessagingConversationDTO = {
  pair_id: string;
  status: PairingStatus;
  counterpart_name: string;
  counterpart_avatar_url: string | null;
  last_message_preview: string | null;
  last_message_at: string | Date | null;
  unread_count: number;
  can_send: boolean;
  /** D2: znacznik ukrycia PO STRONIE WOŁAJĄCEGO; lista domyślna zwraca tylko
   *  null, lista `hidden=true` tylko ustawione. */
  hidden_at: string | Date | null;
};

export type MESSAGING_DTO_API_V1 = {
  /** Wysyła wiadomość do pary (strona = wołający, wyprowadzona z sesji). */
  MESSAGING_SEND: {
    REQUEST: {
      pair_id: string;
      content: string;
    };
    RESPONSE: {
      message: MessagingMessageDTO;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      MESSAGING_DTO_API_V1['MESSAGING_SEND']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      MESSAGING_DTO_API_V1['MESSAGING_SEND']['REQUEST'],
      MESSAGING_DTO_API_V1['MESSAGING_SEND']['RESPONSE'],
      MESSAGING_DTO_API_V1['MESSAGING_SEND']['RESPONSE_ERROR']
    >;
  };

  /** Oznacza wątek pary jako przeczytany (strona wołającego). */
  MESSAGING_MARK_READ: {
    REQUEST: {
      pair_id: string;
    };
    RESPONSE: {
      pair_id: string;
      read_at: string | Date;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      MESSAGING_DTO_API_V1['MESSAGING_MARK_READ']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      MESSAGING_DTO_API_V1['MESSAGING_MARK_READ']['REQUEST'],
      MESSAGING_DTO_API_V1['MESSAGING_MARK_READ']['RESPONSE'],
      MESSAGING_DTO_API_V1['MESSAGING_MARK_READ']['RESPONSE_ERROR']
    >;
  };

  /** Zwraca wiadomości pary (najstarsze→najnowsze, cursor-paginacja) + meta wątku. */
  MESSAGING_GET_THREAD: {
    REQUEST: {
      pair_id: string;
      cursor?: string;
    };
    RESPONSE: {
      meta: MessagingThreadMeta;
      messages: MessagingMessageDTO[];
      next_cursor: string | null;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      MESSAGING_DTO_API_V1['MESSAGING_GET_THREAD']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      MESSAGING_DTO_API_V1['MESSAGING_GET_THREAD']['REQUEST'],
      MESSAGING_DTO_API_V1['MESSAGING_GET_THREAD']['RESPONSE'],
      MESSAGING_DTO_API_V1['MESSAGING_GET_THREAD']['RESPONSE_ERROR']
    >;
  };

  /** Lista rozmów wołającego (pary z wiadomościami, najnowsza pierwsza) + unread.
   *  `hidden=true` = WYŁĄCZNIE rozmowy ukryte przez wołającego („Pokaż ukryte"). */
  MESSAGING_GET_CONVERSATIONS: {
    REQUEST: {
      cursor?: string;
      hidden?: boolean;
    };
    RESPONSE: {
      conversations: MessagingConversationDTO[];
      next_cursor: string | null;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      MESSAGING_DTO_API_V1['MESSAGING_GET_CONVERSATIONS']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      MESSAGING_DTO_API_V1['MESSAGING_GET_CONVERSATIONS']['REQUEST'],
      MESSAGING_DTO_API_V1['MESSAGING_GET_CONVERSATIONS']['RESPONSE'],
      MESSAGING_DTO_API_V1['MESSAGING_GET_CONVERSATIONS']['RESPONSE_ERROR']
    >;
  };

  /** D2: ukrywa rozmowę po stronie wołającego (wyciszenie: znika ze skrzynki,
   *  liczników i listy próśb; zero powiadomień; druga strona niczego nie widzi).
   *  Idempotentne. */
  MESSAGING_HIDE_CONVERSATION: {
    REQUEST: {
      pair_id: string;
    };
    RESPONSE: {
      pair_id: string;
      hidden_at: string | Date;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      MESSAGING_DTO_API_V1['MESSAGING_HIDE_CONVERSATION']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      MESSAGING_DTO_API_V1['MESSAGING_HIDE_CONVERSATION']['REQUEST'],
      MESSAGING_DTO_API_V1['MESSAGING_HIDE_CONVERSATION']['RESPONSE'],
      MESSAGING_DTO_API_V1['MESSAGING_HIDE_CONVERSATION']['RESPONSE_ERROR']
    >;
  };

  /** D2: przywraca ukrytą rozmowę po stronie wołającego. Idempotentne. */
  MESSAGING_UNHIDE_CONVERSATION: {
    REQUEST: {
      pair_id: string;
    };
    RESPONSE: {
      pair_id: string;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      MESSAGING_DTO_API_V1['MESSAGING_UNHIDE_CONVERSATION']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      MESSAGING_DTO_API_V1['MESSAGING_UNHIDE_CONVERSATION']['REQUEST'],
      MESSAGING_DTO_API_V1['MESSAGING_UNHIDE_CONVERSATION']['RESPONSE'],
      MESSAGING_DTO_API_V1['MESSAGING_UNHIDE_CONVERSATION']['RESPONSE_ERROR']
    >;
  };
};
