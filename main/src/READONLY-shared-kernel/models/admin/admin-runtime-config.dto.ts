import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';
import type { RuntimeConfigValueType } from '../../domain/admin/runtime-config.config';

// Re-export RuntimeConfigValueType for consumers
export type { RuntimeConfigValueType } from '../../domain/admin/runtime-config.config';

export type RuntimeConfigEntry = {
  id: string;
  key: string;
  value: string;
  value_type: RuntimeConfigValueType;
  description: string | null;
  is_predefined: boolean;
  updated_at: string;
};

export type AdminRuntimeConfigDtoApi = {
  /** Zwraca listę wpisów konfiguracji runtime (klucz, wartość, typ, opis, flaga predefiniowany). */
  ADMIN_GET_CONFIGS: {
    REQUEST: undefined;
    RESPONSE: { configs: RuntimeConfigEntry[] };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      undefined,
      { configs: RuntimeConfigEntry[] },
      DetailedErrorPayload<undefined>
    >;
  };

  /** Aktualizuje wartość wpisu konfiguracji runtime wskazanego po kluczu. */
  ADMIN_UPDATE_CONFIG: {
    REQUEST: { key: string; value: string };
    RESPONSE: { config: RuntimeConfigEntry };
    RESPONSE_ERROR: DetailedErrorPayload<{ key: string; value: string }>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      { key: string; value: string },
      { config: RuntimeConfigEntry },
      DetailedErrorPayload<{ key: string; value: string }>
    >;
  };

  // DECISION (nie usuwaj tego komentarza):
  // PUBLIC (no-auth) projection of runtime-config. RESPONSE is a DELIBERATELY narrow
  // allow-list — TWO keys, both non-sensitive and intentionally client-facing:
  //   • maintenanceMessage (MAINTENANCE_MESSAGE) — the global maintenance banner.
  //   • verboseLogMode (VERBOSE_LOG_MODE) — the SINGLE end-to-end verbose-logging switch.
  //     Exposed publicly ON PURPOSE so an UNAUTHENTICATED client can learn, at runtime,
  //     whether to ship info-level logs (the client mirrors it into client-verbose.state,
  //     the same VERBOSE_LOG_MODE the backend already syncs into debuggerStates). It is a
  //     bare operational boolean ("verbose on/off") — no config value, threshold, or secret
  //     leaks — so it does NOT weaken the info-disclosure boundary the way exposing
  //     STRIPE_EVENT_JANITOR_* / EVENT_LOG_* / API_TIMING_DEBUG_MODE would. Those stay
  //     admin-internal. See docs/LOGGING.md for the one-flag design.
  // The backend op reads EXACTLY these two keys via getRuntimeConfigValue (never findMany),
  // so the allow-list is structural (the RESPONSE shape) AND enforced at the op level.
  GET_RUNTIME_CONFIG_PUBLIC: {
    REQUEST: undefined;
    RESPONSE: {
      maintenanceMessage: string;
      maintenanceMode: boolean;
      verboseLogMode: boolean;
    };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      undefined,
      {
        maintenanceMessage: string;
        maintenanceMode: boolean;
        verboseLogMode: boolean;
      },
      DetailedErrorPayload<undefined>
    >;
  };
};
