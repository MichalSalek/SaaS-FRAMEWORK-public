import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';
import type { HistoryAccessDTO } from '../pricing/history-access.dto';
import type { VisitRecordSource } from '../db_models.generated.dto';

export type VisitResultPhotoDTO = {
  id: string;
  visitRecordId: string;
  assetUrl: string;
  position: number;
  createdAt: string;
};

export type VisitRecordDTO = {
  id: string;
  clientUserId: string;
  visitDate: string;
  serviceNote: string | null;
  source: VisitRecordSource;
  sessionId: string | null;
  resultPhotos: VisitResultPhotoDTO[];
  createdAt: string;
};

export type VISIT_DTO_API_V1 = {
  /** Zwraca stronicowaną historię wizyt danej klientki dla stylistki, z informacją o zakresie dostępu do historii wg planu (historyAccess). */
  GET_CLIENT_VISITS: {
    REQUEST: {
      client_user_id: string;
      cursor?: string | undefined;
      take?: number | undefined;
    };
    RESPONSE: {
      visits: VisitRecordDTO[];
      nextCursor: string | null;
      historyAccess: HistoryAccessDTO;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      VISIT_DTO_API_V1['GET_CLIENT_VISITS']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      VISIT_DTO_API_V1['GET_CLIENT_VISITS']['REQUEST'],
      VISIT_DTO_API_V1['GET_CLIENT_VISITS']['RESPONSE'],
      VISIT_DTO_API_V1['GET_CLIENT_VISITS']['RESPONSE_ERROR']
    >;
  };

  /** Ręcznie dodaje wpis wizyty klientki przez stylistkę (data wizyty plus opcjonalna notatka usługi); zwraca utworzoną wizytę. */
  CREATE_MANUAL_VISIT: {
    REQUEST: {
      client_user_id: string;
      visit_date: string;
      service_note?: string | undefined;
    };
    RESPONSE: {
      visit: VisitRecordDTO;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      VISIT_DTO_API_V1['CREATE_MANUAL_VISIT']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      VISIT_DTO_API_V1['CREATE_MANUAL_VISIT']['REQUEST'],
      VISIT_DTO_API_V1['CREATE_MANUAL_VISIT']['RESPONSE'],
      VISIT_DTO_API_V1['CREATE_MANUAL_VISIT']['RESPONSE_ERROR']
    >;
  };

  /** Aktualizuje notatkę usługi (service_note) istniejącej wizyty; zwraca zaktualizowaną wizytę. */
  UPDATE_VISIT_NOTE: {
    REQUEST: {
      visit_id: string;
      service_note: string;
    };
    RESPONSE: {
      visit: VisitRecordDTO;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      VISIT_DTO_API_V1['UPDATE_VISIT_NOTE']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      VISIT_DTO_API_V1['UPDATE_VISIT_NOTE']['REQUEST'],
      VISIT_DTO_API_V1['UPDATE_VISIT_NOTE']['RESPONSE'],
      VISIT_DTO_API_V1['UPDATE_VISIT_NOTE']['RESPONSE_ERROR']
    >;
  };

  /** Dodaje zdjęcie efektu (asset_url) do wizyty; zwraca utworzony rekord zdjęcia. */
  ADD_VISIT_RESULT_PHOTO: {
    REQUEST: {
      visit_id: string;
      asset_url: string;
    };
    RESPONSE: {
      photo: VisitResultPhotoDTO;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      VISIT_DTO_API_V1['ADD_VISIT_RESULT_PHOTO']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      VISIT_DTO_API_V1['ADD_VISIT_RESULT_PHOTO']['REQUEST'],
      VISIT_DTO_API_V1['ADD_VISIT_RESULT_PHOTO']['RESPONSE'],
      VISIT_DTO_API_V1['ADD_VISIT_RESULT_PHOTO']['RESPONSE_ERROR']
    >;
  };

  /** Usuwa zdjęcie efektu (photo_id) z wizyty; zwraca flagę powodzenia. */
  REMOVE_VISIT_RESULT_PHOTO: {
    REQUEST: {
      visit_id: string;
      photo_id: string;
    };
    RESPONSE: {
      success: boolean;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      VISIT_DTO_API_V1['REMOVE_VISIT_RESULT_PHOTO']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      VISIT_DTO_API_V1['REMOVE_VISIT_RESULT_PHOTO']['REQUEST'],
      VISIT_DTO_API_V1['REMOVE_VISIT_RESULT_PHOTO']['RESPONSE'],
      VISIT_DTO_API_V1['REMOVE_VISIT_RESULT_PHOTO']['RESPONSE_ERROR']
    >;
  };

  /** Usuwa ręcznie dodaną wizytę (visit_id); zwraca flagę powodzenia. */
  DELETE_MANUAL_VISIT: {
    REQUEST: {
      visit_id: string;
    };
    RESPONSE: {
      success: boolean;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      VISIT_DTO_API_V1['DELETE_MANUAL_VISIT']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      VISIT_DTO_API_V1['DELETE_MANUAL_VISIT']['REQUEST'],
      VISIT_DTO_API_V1['DELETE_MANUAL_VISIT']['RESPONSE'],
      VISIT_DTO_API_V1['DELETE_MANUAL_VISIT']['RESPONSE_ERROR']
    >;
  };

  /** Zwraca prywatną notatkę CRM stylistki o klientce (treść plus data aktualizacji); dostęp zależny od planu. */
  CLIENT_GET_CRM_NOTE: {
    REQUEST: {
      client_user_id: string;
    };
    RESPONSE: {
      note: string | null;
      updatedAt: string | null;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      VISIT_DTO_API_V1['CLIENT_GET_CRM_NOTE']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      VISIT_DTO_API_V1['CLIENT_GET_CRM_NOTE']['REQUEST'],
      VISIT_DTO_API_V1['CLIENT_GET_CRM_NOTE']['RESPONSE'],
      VISIT_DTO_API_V1['CLIENT_GET_CRM_NOTE']['RESPONSE_ERROR']
    >;
  };

  /** Zapisuje lub aktualizuje (upsert) prywatną notatkę CRM stylistki o klientce; zwraca treść i datę aktualizacji. */
  CLIENT_UPSERT_CRM_NOTE: {
    REQUEST: {
      client_user_id: string;
      note: string;
    };
    RESPONSE: {
      note: string | null;
      updatedAt: string | null;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      VISIT_DTO_API_V1['CLIENT_UPSERT_CRM_NOTE']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      VISIT_DTO_API_V1['CLIENT_UPSERT_CRM_NOTE']['REQUEST'],
      VISIT_DTO_API_V1['CLIENT_UPSERT_CRM_NOTE']['RESPONSE'],
      VISIT_DTO_API_V1['CLIENT_UPSERT_CRM_NOTE']['RESPONSE_ERROR']
    >;
  };

  /** Kasuje prywatną notatkę CRM stylistki o klientce w KAŻDYM stanie pary (także po zerwaniu i przy nieaktywnym koncie klientki); odpowiedź = stan po operacji (bez licznika, D4 anty-oracle). */
  CLIENT_DELETE_CRM_NOTE: {
    REQUEST: {
      client_user_id: string;
    };
    RESPONSE: {
      note: null;
      updatedAt: null;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      VISIT_DTO_API_V1['CLIENT_DELETE_CRM_NOTE']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      VISIT_DTO_API_V1['CLIENT_DELETE_CRM_NOTE']['REQUEST'],
      VISIT_DTO_API_V1['CLIENT_DELETE_CRM_NOTE']['RESPONSE'],
      VISIT_DTO_API_V1['CLIENT_DELETE_CRM_NOTE']['RESPONSE_ERROR']
    >;
  };
};
