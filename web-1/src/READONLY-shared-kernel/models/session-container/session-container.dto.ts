import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';
import type { SessionContainerLifecycleState } from '../db_models.generated.dto';
import type { NailLength } from '../../domain/gallery/nail-length.config';

/**
 * Wire-format DTOs for the Session Container API (R8).
 *
 * Conventions:
 * - All timestamps are ISO strings on the wire
 * - `photoCount` is a denormalized helper for list views (avoids N+1 fetches)
 * - `SessionDetailDTO` extends `SessionDTO` with hydrated `photos[]`
 */

export type SessionContainerPhotoDTO = {
  id: string;
  sessionId: string;
  galleryRecordId: string;
  position: number;
  createdAt: string;
  galleryRecord?: {
    gallery_record_id: string;
    asset_url: string;
    nail_length: NailLength;
    is_pinned: boolean;
    created_by_account_id: string;
  };
};

export type SessionContainerDTO = {
  id: string;
  clientAccountId: string;
  // Resolved display name of the session's client (User.name of the owning
  // client account). Hydrated ONLY on read paths that join the client account
  // (get-my, get-by-id) — the stylist's inbox uses it to show WHO shared a
  // session instead of an opaque handle. `null` when the name is unset/blank or
  // when the producing path does not hydrate the relation (write responses).
  // Not stylist-private: the owning client sees her own name, and a stylist only
  // ever receives rows already authorized to her — get-my's WHERE restricts her to
  // SHARED/ACTIVE sessions, and get-by-id's ownership + terminal-never-shared guards
  // run before hydration. (Field masking via resolveViewerSide governs stylistNote
  // only, not this field.)
  clientName: string | null;
  // User id of the owning client, hydrated on the same read paths as
  // clientName (null elsewhere). The stylist's pair list is keyed by user id
  // while a session carries the client ACCOUNT id; this joins the two (e.g. the
  // dashboard face strip marks clients with a pending shared session). Only
  // the owning client and the assigned stylist receive it; after a revoke the
  // stylist keeps it on the archived session like clientName (CRM archive,
  // SCCAP-3) although get-my-pairs no longer lists that client.
  clientUserId: string | null;
  stylistAccountId: string | null;
  name: string | null;
  lifecycleState: SessionContainerLifecycleState;
  stylistNote: string | null;
  clientNote: string | null;
  sharedAt: string | null;
  expiresAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  photoCount: number;
};

export type SessionContainerDetailDTO = SessionContainerDTO & {
  photos: SessionContainerPhotoDTO[];
};

export type SESSION_CONTAINER_DTO_API_V1 = {
  /** Tworzy nowy kontener sesji klientki (opcjonalnie przypisany do stylistki i nazwany); zwraca utworzoną sesję. */
  SESSION_CONTAINER_CREATE: {
    REQUEST: {
      stylist_account_id?: string | undefined;
      name?: string | undefined;
    };
    RESPONSE: {
      session: SessionContainerDTO;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CREATE']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CREATE']['REQUEST'],
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CREATE']['RESPONSE'],
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CREATE']['RESPONSE_ERROR']
    >;
  };

  /** Dołącza zdjęcie z galerii (gallery_record_id) do kontenera sesji; zwraca sesję z listą zdjęć. Idempotentne po parze sesja+zdjęcie. */
  SESSION_CONTAINER_ADD_PHOTO: {
    REQUEST: {
      session_id: string;
      gallery_record_id: string;
    };
    RESPONSE: {
      session: SessionContainerDetailDTO;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_ADD_PHOTO']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_ADD_PHOTO']['REQUEST'],
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_ADD_PHOTO']['RESPONSE'],
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_ADD_PHOTO']['RESPONSE_ERROR']
    >;
  };

  /** Udostępnia kontener sesji stylistce (akcja klientki); zwraca zaktualizowaną sesję i wysyła powiadomienie mailowe stylistce. */
  SESSION_CONTAINER_SHARE: {
    REQUEST: {
      session_id: string;
    };
    RESPONSE: {
      session: SessionContainerDTO;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_SHARE']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_SHARE']['REQUEST'],
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_SHARE']['RESPONSE'],
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_SHARE']['RESPONSE_ERROR']
    >;
  };

  /** Zamyka kontener sesji (session_id); zwraca zaktualizowaną sesję. */
  SESSION_CONTAINER_CLOSE: {
    REQUEST: {
      session_id: string;
    };
    RESPONSE: {
      session: SessionContainerDTO;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CLOSE']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CLOSE']['REQUEST'],
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CLOSE']['RESPONSE'],
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CLOSE']['RESPONSE_ERROR']
    >;
  };

  /** Zwraca stronicowaną listę kontenerów sesji zalogowanego użytkownika (kursor plus nextCursor). */
  SESSION_CONTAINER_GET_MY: {
    REQUEST: { cursor?: string; take?: number } | undefined;
    RESPONSE: {
      sessions: SessionContainerDTO[];
      nextCursor: string | null;
    };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_GET_MY']['REQUEST'],
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_GET_MY']['RESPONSE'],
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_GET_MY']['RESPONSE_ERROR']
    >;
  };

  /** Zwraca pełny kontener sesji po id (session_id) wraz z listą zdjęć. */
  SESSION_CONTAINER_GET_BY_ID: {
    REQUEST: {
      session_id: string;
    };
    RESPONSE: {
      session: SessionContainerDetailDTO;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_GET_BY_ID']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_GET_BY_ID']['REQUEST'],
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_GET_BY_ID']['RESPONSE'],
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_GET_BY_ID']['RESPONSE_ERROR']
    >;
  };

  /** Zapisuje notatkę do sesji po stronie stylistki albo klientki (pole side); backend wymusza, którą stronę może pisać dany użytkownik. */
  SESSION_CONTAINER_SET_NOTE: {
    REQUEST: {
      session_id: string;
      note: string;
      // 'stylist' | 'client' — backend uses currentUser to enforce which side may write which.
      // The discriminator is passed for explicit intent — backend re-derives the actual side from session context.
      side: 'stylist' | 'client';
    };
    RESPONSE: {
      session: SessionContainerDTO;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_SET_NOTE']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_SET_NOTE']['REQUEST'],
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_SET_NOTE']['RESPONSE'],
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_SET_NOTE']['RESPONSE_ERROR']
    >;
  };
};
