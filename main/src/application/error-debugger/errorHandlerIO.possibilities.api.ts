import { ENDPOINTS } from '../http/http.endpoints';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { ENV_VARS } from '../environment/environment.config';
import { IS_DEVELOPMENT_ENV } from '../environment/environment.possibilities.api';

// FDX FAZA 2 (W2.4): `getLogs_IO` (admin Event-Log viewer) przeniesione do
// `domain/admin/logs/adminLogsIO.possibilities.api.ts` i zmigrowane na promise-first
// front-door (`defineQuery`). Ten plik trzyma TYLKO fire-and-forget beacon
// (poniżej) — celowo NIE importuje `io.ts`, bo errorHandlerIO siedzi w cyklu
// importów z http.possibilities.api (eager `defineQuery` tu = TDZ przy module-init).

const BEACON_MAX_BYTES = 60_000;
const url = ENDPOINTS.SEND_LOG({ ENV_VARS });

type SendLogRequest = ADMIN_DTO_API_V1['SEND_LOG']['REQUEST'];

// DECISION (nie usuwaj tego komentarza) — WYJĄTEK od front-door (io.ts EXCEPTIONS):
// sendEventLogBeacon_IO to FIRE-AND-FORGET log-sender via `navigator.sendBeacon`
// — z definicji jednokierunkowy (brak request/response, brak Promise<Res>, brak
// callbacków). NIE da się wyrazić jako `defineEndpoint` (transport in → Promise
// out); beacon nie przechodzi przez `callHTTPEndpoint` / interceptor (musi przeżyć
// `pagehide`/unload, dlatego sendBeacon a nie fetch). ZOSTAJE raw.
/** Fire-and-forget log sender via sendBeacon. No callbacks — intentionally one-way. */
export const sendEventLogBeacon_IO = (req: SendLogRequest): void => {
  if (IS_DEVELOPMENT_ENV() && !ENV_VARS.NEXT_PUBLIC_ENABLE_EVENT_LOG_DB) {
    return;
  }

  if (
    typeof navigator === 'undefined' ||
    typeof navigator.sendBeacon !== 'function'
  ) {
    return;
  }

  const sendBeaconData = new Blob([JSON.stringify(req)], {
    type: 'application/json',
  });

  if (sendBeaconData.size > BEACON_MAX_BYTES) {
    const truncated = {
      ...req,
      payload: req.payload.slice(0, 500) + '...[TRUNCATED]',
    };
    const fallback = new Blob([JSON.stringify(truncated)], {
      type: 'application/json',
    });
    navigator.sendBeacon(url, fallback);
    return;
  }

  navigator.sendBeacon(url, sendBeaconData);
};
