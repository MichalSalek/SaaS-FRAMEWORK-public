import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';

// Announcement types
export type AnnouncementType = 'info' | 'warning' | 'critical';

export type AnnouncementDTO = {
  id: string;
  title: string;
  message: string;
  type: AnnouncementType;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  // fk-ondelete-policies-2 (2026-06-03): nullable — Announcement.created_by_user_id stało się
  // nullable (onDelete: SetNull) bo autor to audyt-only, nie warunek bytu globalnego ogłoszenia.
  // Wymagane przy create; NULL tylko po hard-delete autora (GDPR Art.17).
  created_by_user_id: string | null;
  created_at: string;
};

type CreateAnnouncementRequest = {
  title: string;
  message: string;
  type: AnnouncementType;
  is_active: boolean;
  starts_at?: string;
  ends_at?: string;
};

type UpdateAnnouncementRequest = {
  id: string;
  title?: string;
  message?: string;
  type?: AnnouncementType;
  is_active?: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
};

export type AdminAnnouncementsDtoApi = {
  /** Zwraca pełną listę ogłoszeń systemowych (wszystkie pola) dla panelu admina. */
  ADMIN_GET_ANNOUNCEMENTS: {
    REQUEST: undefined;
    RESPONSE: AnnouncementDTO[];
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      undefined,
      AnnouncementDTO[],
      DetailedErrorPayload<undefined>
    >;
  };

  /** Tworzy ogłoszenie systemowe (tytuł, treść, typ, aktywność, okno czasowe); zwraca id. */
  ADMIN_CREATE_ANNOUNCEMENT: {
    REQUEST: CreateAnnouncementRequest;
    RESPONSE: { id: string };
    RESPONSE_ERROR: DetailedErrorPayload<{
      title: string;
      message: string;
      type: string;
      is_active: string;
      starts_at: string;
      ends_at: string;
    }>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      CreateAnnouncementRequest,
      { id: string },
      DetailedErrorPayload<{
        title: string;
        message: string;
        type: string;
        is_active: string;
        starts_at: string;
        ends_at: string;
      }>
    >;
  };

  /** Aktualizuje ogłoszenie systemowe po id (tytuł, treść, typ, aktywność, okno czasowe). */
  ADMIN_UPDATE_ANNOUNCEMENT: {
    REQUEST: UpdateAnnouncementRequest;
    RESPONSE: undefined;
    RESPONSE_ERROR: DetailedErrorPayload<{
      id: string;
      title: string;
      message: string;
      type: string;
      is_active: string;
      starts_at: string;
      ends_at: string;
    }>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      UpdateAnnouncementRequest,
      undefined,
      DetailedErrorPayload<{
        id: string;
        title: string;
        message: string;
        type: string;
        is_active: string;
        starts_at: string;
        ends_at: string;
      }>
    >;
  };

  /** Usuwa ogłoszenie systemowe po id. */
  ADMIN_DELETE_ANNOUNCEMENT: {
    REQUEST: { id: string };
    RESPONSE: undefined;
    RESPONSE_ERROR: DetailedErrorPayload<{ id: string }>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      { id: string },
      undefined,
      DetailedErrorPayload<{ id: string }>
    >;
  };

  /** Zwraca aktywne ogłoszenia (id, tytuł, treść, typ) do wyświetlenia użytkownikom. */
  ANNOUNCEMENTS_GET_ACTIVE: {
    REQUEST: undefined;
    RESPONSE: Pick<AnnouncementDTO, 'id' | 'title' | 'message' | 'type'>[];
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      undefined,
      Pick<AnnouncementDTO, 'id' | 'title' | 'message' | 'type'>[],
      DetailedErrorPayload<undefined>
    >;
  };
};
