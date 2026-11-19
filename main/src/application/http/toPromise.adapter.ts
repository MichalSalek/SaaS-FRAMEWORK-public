// main/src/application/http/toPromise.adapter.ts
// Bridge: callback-based IO functions --> Promise-based functions for TanStack Query.
// Preserves all 3 generics (Req, Res, Err) from IOClientFunctionReqResErr.
// TS infers them from ioFn — callers NEVER provide generics manually.

import type { HTTPError } from '@kernel/application/http/http.types';
import type {
  IOClientCallOptions,
  IOClientFunctionReqResErr,
} from '@kernel/application/http/http.client.types';

/**
 * Error wrapper — preserves typed httpError without classes.
 * Components access field-level errors via `error.httpError.data?.fieldName`.
 */
export type IOError<E> = Error & { httpError: HTTPError<E> };

const createIOError = <E>(httpError: HTTPError<E>): IOError<E> =>
  Object.assign(new Error(httpError.event), { httpError });

/**
 * Type guard for the typed IO error envelope. `IOError` stores the event under
 * `httpError.event`, not at the top level — the kernel `hasEvent` narrower
 * (which checks `error.event`) does NOT match this envelope. Shared per the
 * rule of three (3rd call site: ReportModal; previously duplicated inline in
 * DataExportSection.tsx and pairingClaimErrors.config.tsx).
 */
export function isIOError(err: unknown): err is IOError<unknown> {
  return (
    err instanceof Error &&
    typeof (err as { httpError?: unknown }).httpError === 'object' &&
    (err as { httpError?: unknown }).httpError !== null
  );
}

/**
 * Converts a callback-based IO function into a Promise-returning function.
 *
 * Accepts an optional `IOClientCallOptions` (e.g. `{ signal }`) — pass through
 * TanStack Query's `queryFn({ signal })` so the in-flight fetch can be
 * cancelled when the query is dropped (unmount, refocus, key change).
 *
 * Usage with queryOptions():
 * ```ts
 * const exploreGallery = toPromise(exploreGalleryRecords_IO);
 * // exploreGallery: (req: ExploreRequest, options?: { signal }) => Promise<ExploreResponse>
 * // In queryFn:
 * //   queryFn: ({ pageParam, signal }) => exploreGallery(req, { signal }),
 * ```
 */
export const toPromise = <Req, Res, Err>(
  ioFn: IOClientFunctionReqResErr<Req, Res, Err>
) => {
  return (req: Req, options?: IOClientCallOptions): Promise<Res> =>
    new Promise<Res>((resolve, reject) => {
      void ioFn(
        req,
        async r => resolve(r.data),
        async e => reject(createIOError<Err>(e)),
        options
      );
    });
};
