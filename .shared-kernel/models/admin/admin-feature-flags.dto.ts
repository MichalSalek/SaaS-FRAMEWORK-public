import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';

export type FeatureFlagDTO = {
  id: string;
  key: string;
  description: string | null;
  is_enabled: boolean;
  expires_at: string | null;
  updated_at: string;
};

export type AdminFeatureFlagsDtoApi = {
  /** Zwraca listę flag funkcji (klucz, opis, stan włączenia, data wygaśnięcia). */
  ADMIN_GET_FEATURE_FLAGS: {
    REQUEST: undefined;
    RESPONSE: FeatureFlagDTO[];
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      undefined,
      FeatureFlagDTO[],
      DetailedErrorPayload<undefined>
    >;
  };

  /** Przełącza flagę funkcji (włącz albo wyłącz) wskazaną po kluczu. */
  ADMIN_TOGGLE_FEATURE_FLAG: {
    REQUEST: { key: string; is_enabled: boolean };
    RESPONSE: FeatureFlagDTO;
    RESPONSE_ERROR: DetailedErrorPayload<{ key: string; is_enabled: boolean }>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      { key: string; is_enabled: boolean },
      FeatureFlagDTO,
      DetailedErrorPayload<{ key: string; is_enabled: boolean }>
    >;
  };

  /** Publiczna mapa flag funkcji (klucz oraz stan włączenia) dla klienta bez autoryzacji. */
  GET_FEATURE_FLAGS_PUBLIC: {
    REQUEST: undefined;
    RESPONSE: Record<string, boolean>;
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      undefined,
      Record<string, boolean>,
      DetailedErrorPayload<undefined>
    >;
  };
};
