// TQ v5 query: GET /api/v1/runtime-config (public). Two fields: maintenanceMessage (banner) and
// verboseLogMode (the single logging switch, docs/LOGGING.md). Fail-soft: empty message +
// verbose off on any error, so a backend outage never blocks the UI. Cached 5 min.
//
// Two hooks share ONE query (same queryKey → one fetch):
//   • useMaintenanceMessage: the banner text (mounts inside layouts only).
//   • useVerboseLogSync: publishes verboseLogMode into the client mirror; mount it
//     app-wide (VerboseLogSyncController in _app.tsx) so the flag is learned on the
//     layout-less /login, /welcome, /maintenance pages too. The setClientVerboseLog
//     side effect lives in the shared fetch, so whichever hook drives it feeds the mirror.
//
// The IO lives in the domain (`domain/public/publicIO.possibilities.api.ts`). The fail-soft
// resolve to '' lives in the hook (try/catch), not in the IO; see the DECISION in
// application/http/io.ts.

import { useQuery } from '@tanstack/react-query';
import { getPublicRuntimeConfig_IO } from '../../../../domain/public/publicIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { setClientVerboseLog } from '../../../../application/error-debugger/client-verbose.state';
import { backgroundQueryRetryOptions } from '../../../../application/http/background-retry-policy';

const STALE_MS = 5 * 60 * 1000;

interface PublicMaintenanceConfig {
  message: string;
  mode: boolean;
}

async function fetchMaintenanceMessage(opts: {
  signal?: AbortSignal;
}): Promise<PublicMaintenanceConfig> {
  try {
    // Promise-first IO resolves with the UNWRAPPED response body —
    // here `{ maintenanceMessage, verboseLogMode }`.
    const config = await getPublicRuntimeConfig_IO(
      undefined,
      opts.signal ? { signal: opts.signal } : undefined
    );
    // Feed the client verbose-log mirror (FRONTEND half of VERBOSE_LOG_MODE).
    setClientVerboseLog(config?.verboseLogMode ?? false);
    // Fail-soft: backend may return an empty/absent message → banner stays hidden.
    return {
      message: config?.maintenanceMessage ?? '',
      mode: config?.maintenanceMode ?? false,
    };
  } catch (error) {
    // Fail-closed on both outputs: banner hidden, verbose logging off.
    setClientVerboseLog(false);
    // Re-throw so TanStack Query can apply the shared background retry policy.
    // The consuming hooks still map the final error to their safe UI fallback.
    throw error;
  }
}

/**
 * Public maintenance-banner message. Empty string = no active maintenance
 * (banner renders nothing). Sourced from the live backend, fail-soft to ''.
 */
export function useMaintenanceMessage(): string {
  const { data } = useQuery({
    queryKey: queryKeys.public.maintenanceMessage,
    queryFn: ({ signal }) => fetchMaintenanceMessage({ signal }),
    staleTime: STALE_MS,
    gcTime: 15 * 60_000,
    ...backgroundQueryRetryOptions,
  });
  // Last KNOWN value, not `isError ? ''`: in TanStack v5 a failed background
  // refetch keeps the previous data next to isError, and dropping it blinked
  // the banner off on every failed poll. No data yet (first fetch failed)
  // still falls back to '' (fail-soft).
  return data?.message ?? '';
}

/**
 * The hard door closing (`MAINTENANCE_MODE`), unlike the info bar above. `null` =
 * the config was never read (first read in flight, or failed). The consumer treats
 * `null` as „open" (fail-soft: a failed read must not close the product), but NOT
 * as „mode lifted": only a confirmed `false` takes the visitor off the downtime page.
 * Consumer: `MaintenanceGateComposition` in `_app`.
 */
export function useMaintenanceMode(options?: {
  pollMs?: number;
}): boolean | null {
  const pollMs = options?.pollMs;
  const { data } = useQuery({
    queryKey: queryKeys.public.maintenanceMessage,
    queryFn: ({ signal }) => fetchMaintenanceMessage({ signal }),
    // The downtime page itself polls more often than the rest of the product (see
    // its DECISION): otherwise a user sent there would sit on it until `staleTime`
    // ends, even after the admin lifted the knob.
    ...(pollMs !== undefined
      ? {
          staleTime: 0,
          refetchInterval: pollMs,
          refetchIntervalInBackground: false,
        }
      : { staleTime: STALE_MS }),
    gcTime: 15 * 60_000,
    ...backgroundQueryRetryOptions,
  });
  // Last KNOWN value (see useMaintenanceMessage). Reading `isError ? false`
  // flapped the gate: one failed 60 s poll on /maintenance (a restarting
  // backend during the very downtime) sent the visitor to the home page and
  // the next successful poll sent them back. No config read yet → `null`, not
  // `false`: a reload of /maintenance otherwise bounced to the home page while
  // the first read was still in flight (and stayed there if it failed).
  return data === undefined ? null : data.mode;
}

/**
 * App-wide sync of the VERBOSE_LOG_MODE flag into the client verbose-log mirror.
 * Mount ONCE, high in the tree and OUTSIDE any page layout (VerboseLogSyncController
 * in _app.tsx), so the flag is learned on EVERY page — including the layout-less
 * /login, /welcome and /maintenance, where the MaintenanceBanner never mounts and
 * would otherwise leave getClientVerboseLog() stuck false on a fresh-document load
 * (silently dropping info logs exactly where the native-login diagnostics fire).
 * Shares the banner's queryKey + queryFn → ONE network fetch. Returns nothing.
 */
export function useVerboseLogSync(): void {
  useQuery({
    queryKey: queryKeys.public.maintenanceMessage,
    queryFn: ({ signal }) => fetchMaintenanceMessage({ signal }),
    staleTime: STALE_MS,
    gcTime: 15 * 60_000,
    ...backgroundQueryRetryOptions,
  });
}
