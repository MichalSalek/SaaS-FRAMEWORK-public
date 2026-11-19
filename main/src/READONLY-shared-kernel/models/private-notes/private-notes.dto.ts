import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';

/** The client a note is about, as the stylist knows her. */
export type PrivateNoteClientDTO = {
  client_user_id: string;
  /** Her account name; null when she never set one. */
  name: string | null;
};

/** The stylist's note on the client card (`ClientStylistPair.crm_note`). */
export type ClientCardNoteDTO = {
  client: PrivateNoteClientDTO;
  note: string;
  updated_at: string;
};

/**
 * „Ważne przed wizytą” about one client (`ClientStylistPair.important_note`): the one thing the
 * stylist must not miss. Not plan-gated, unlike the client-card note.
 */
export type ClientImportantNoteDTO = {
  client: PrivateNoteClientDTO;
  note: string;
  updated_at: string;
};

/**
 * A note of an Inspiration Session. `author` says who wrote it, because the two
 * are not equally private: the stylist's note is hers alone, the client's note
 * was written BY the client and the client sees it too.
 */
export type SessionNoteDTO = {
  session_id: string;
  session_name: string | null;
  client: PrivateNoteClientDTO;
  author: 'STYLIST' | 'CLIENT';
  note: string;
  /** Last change of the session row (the notes have no timestamp of their own). */
  updated_at: string;
};

/** What the stylist wrote about one visit (`VisitRecord.service_note`). */
export type VisitNoteDTO = {
  visit_id: string;
  client: PrivateNoteClientDTO;
  note: string;
  visit_date: string;
};

export type PRIVATE_NOTES_DTO_API_V1 = {
  /**
   * Every note the stylist can read, in one bounded read: client-card notes, session notes and
   * visit notes, each list newest first and capped (`*_truncated` says when the cap cut it). The
   * general note keeps its own endpoint (ACCOUNT_GET_DASHBOARD_NOTE). Client-card and visit notes
   * follow the client-card plan gate: without it both lists are empty and `history_locked` is true.
   * „Ważne przed wizytą” (`important_notes`) has NO plan gate: safety information on every plan.
   */
  ACCOUNT_GET_PRIVATE_NOTES: {
    REQUEST: {
      /** Only the notes about this client. */
      client_user_id?: string | undefined;
    };
    RESPONSE: {
      history_locked: boolean;
      important_notes: ClientImportantNoteDTO[];
      important_notes_truncated: boolean;
      /** Every client with at least one note, for the filter (independent of the filter). */
      clients: PrivateNoteClientDTO[];
      client_notes: ClientCardNoteDTO[];
      client_notes_truncated: boolean;
      session_notes: SessionNoteDTO[];
      session_notes_truncated: boolean;
      visit_notes: VisitNoteDTO[];
      visit_notes_truncated: boolean;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      PRIVATE_NOTES_DTO_API_V1['ACCOUNT_GET_PRIVATE_NOTES']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      PRIVATE_NOTES_DTO_API_V1['ACCOUNT_GET_PRIVATE_NOTES']['REQUEST'],
      PRIVATE_NOTES_DTO_API_V1['ACCOUNT_GET_PRIVATE_NOTES']['RESPONSE'],
      PRIVATE_NOTES_DTO_API_V1['ACCOUNT_GET_PRIVATE_NOTES']['RESPONSE_ERROR']
    >;
  };
};
