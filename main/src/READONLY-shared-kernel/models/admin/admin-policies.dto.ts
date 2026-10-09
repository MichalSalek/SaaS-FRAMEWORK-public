import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';
import type { Policy } from '../db_models.generated.dto';

type SavePolicyRequest = {
  id?: string;
  title: string;
  content: string;
};

export type AdminPoliciesDtoApi = {
  /** Pobiera listę wszystkich dokumentów polityk. */
  ADMIN_GET_POLICIES: {
    REQUEST: undefined;
    RESPONSE: { policies: Policy[] };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      undefined,
      { policies: Policy[] },
      DetailedErrorPayload<undefined>
    >;
  };

  /** Zapisuje dokument polityki (tworzy nowy albo aktualizuje istniejący, gdy podano id); zwraca policy_id. */
  ADMIN_SAVE_POLICY: {
    REQUEST: SavePolicyRequest;
    RESPONSE: { policy_id: string };
    RESPONSE_ERROR: DetailedErrorPayload<{
      id: string;
      title: string;
      content: string;
    }>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SavePolicyRequest,
      { policy_id: string },
      DetailedErrorPayload<{ id: string; title: string; content: string }>
    >;
  };

  /** Usuwa dokument polityki wskazany przez id. */
  ADMIN_DELETE_POLICY: {
    REQUEST: { id: string };
    RESPONSE: { success: boolean };
    RESPONSE_ERROR: DetailedErrorPayload<{ id: string }>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      { id: string },
      { success: boolean },
      DetailedErrorPayload<{ id: string }>
    >;
  };

  /** Oznacza wskazany dokument polityki jako główny (obowiązujący). */
  ADMIN_SET_MAIN_POLICY: {
    REQUEST: { id: string };
    RESPONSE: undefined;
    RESPONSE_ERROR: DetailedErrorPayload<{ id: string }>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      { id: string },
      undefined,
      DetailedErrorPayload<{ id: string }>
    >;
  };
};
