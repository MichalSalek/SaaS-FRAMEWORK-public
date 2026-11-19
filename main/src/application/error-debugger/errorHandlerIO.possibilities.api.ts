import { ENDPOINTS } from '../http/http.endpoints';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { ENV_VARS } from '../environment/environment.config';
import { IS_DEVELOPMENT_ENV } from '../environment/environment.possibilities.api';

// This file holds ONLY the fire-and-forget beacon (below). It deliberately does NOT import `io.ts`:
// errorHandlerIO sits in an import cycle with http.possibilities.api, and an eager `defineQuery`
// here would hit a TDZ error at module init.

const BEACON_MAX_BYTES = 60_000;
const url = ENDPOINTS.SEND_LOG({ ENV_VARS });

type SendLogRequest = ADMIN_DTO_API_V1['SEND_LOG']['REQUEST'];

// DECISION: exception to the front door (io.ts EXCEPTIONS). sendEventLogBeacon_IO is a
// FIRE-AND-FORGET sender via `navigator.sendBeacon`: one-way by definition (no response, no
// callbacks), so it cannot be a `defineEndpoint` (request in, Promise out). It bypasses
// `callHTTPEndpoint` and the interceptor because it must survive `pagehide`/unload, which is why it
// is sendBeacon and not fetch. Stays raw.
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
