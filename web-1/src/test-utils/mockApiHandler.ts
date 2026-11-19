import { createMocks, type RequestMethod } from 'node-mocks-http';
import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { __setDb } from './setup';

export type MockApiResult<TData = unknown> = {
  /** HTTP status code written by the handler. */
  status: number;
  /** `event` field of the `{ event, data }` envelope (undefined for non-JSON sends). */
  event: string | undefined;
  /** `data` field of the envelope, typed by the caller. */
  data: TData;
  /** Raw parsed JSON body (whole envelope), for assertions beyond event/data. */
  raw: unknown;
};

export type MockApiOptions = {
  method: RequestMethod;
  /** Request body (arbitrary JSON object) — handlers narrow it via their validator. */
  body?: Record<string, unknown>;
  query?: Record<string, string | string[]>;
  headers?: Record<string, string>;
  /** Defaults to '/api/v1/test'. Must start with '/api' for typical API routes. */
  url?: string;
};

/**
 * Build a typed DB stub served by `DB_CLIENT.use` for the duration of the test.
 *
 * Each key is a Prisma model name (camelCase, e.g. `galleryRecord`, `stylistAccount`);
 * each value is a partial map of method → async fn. Methods you don't stub will throw
 * a descriptive "not mocked" error if the code under test calls them (fail-loud).
 * `$transaction` is handled by the setup proxy (runs the callback with this same map
 * as `tx`); `$executeRaw`/`$queryRaw` default to no-ops unless stubbed here.
 *
 * @example
 *   mockDb({ galleryRecord: { count: async () => 0, create: async () => fixture } });
 */
export const mockDb = (
  models: Record<string, Record<string, (...args: never[]) => unknown>>
): void => {
  __setDb(models as Record<string, unknown>);
};

/**
 * Stubs for the cloud-file ownership gate: an indexed `public_id` read plus
 * rows whose URL does not parse, on gallery, visit photos and stylist accounts.
 * The gate sits on every client file URL, so a missing stub throws
 * `findFirst is not a function` and looks like a product bug. A non-empty
 * `foreignRow` means another owner already holds the file.
 *
 * @example
 *   const ownership = assetOwnershipStubs();
 *   mockDb({ ...ownership, galleryRecord: { ...ownership.galleryRecord, count, create } });
 */
export const assetOwnershipStubs = (
  foreignRow: { id: string } | null = null
): Record<string, Record<string, (...args: never[]) => unknown>> => {
  const none = async () => [];
  return {
    galleryRecord: { findFirst: async () => foreignRow, findMany: none },
    visitResultPhoto: { findFirst: async () => null, findMany: none },
    user: { findFirst: async () => null, findMany: none },
    stylistAccount: {
      findUnique: async () => ({
        created_by_user_id: 'test-owner',
        account_id: 'test-account',
      }),
      findFirst: async () => null,
      findMany: none,
    },
  };
};

/**
 * Invoke a handler and return the parsed envelope.
 *
 * @param handler the handler's DEFAULT export (already wrapped in timing middleware).
 */
export const mockApiHandler = async <TData = unknown>(
  handler: NextApiHandler,
  options: MockApiOptions
): Promise<MockApiResult<TData>> => {
  // Build options conditionally: tsconfig has `exactOptionalPropertyTypes`, so an
  // explicit `undefined` is NOT assignable to an optional property — only spread the
  // keys that are actually provided.
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: options.method,
    url: options.url ?? '/api/v1/test',
    ...(options.body !== undefined && { body: options.body }),
    ...(options.query !== undefined && { query: options.query }),
    ...(options.headers !== undefined && { headers: options.headers }),
  });

  await handler(req, res);

  const status = res._getStatusCode();

  // Envelope parse: handlers respond via res.json({ event, data }). Some branches
  // (CORS 406) use res.send(string) — then there's no JSON. (The method guard used
  // to be in that list with `send(null)`; it now answers through
  // respondMethodNotAllowed, i.e. a normal 405 envelope.)
  // The middleware VALIDATION path (request.middleware step 6) responds via
  // res.status(400).send({ event, data }) — a plain OBJECT, which node-mocks-http
  // does not expose through _getJSONData() (it JSON.parses the raw data, and an
  // object coerces to "[object Object]"). Fall back to _getData() for that shape so
  // validation-reject envelopes are assertable like every other envelope.
  let raw: unknown;
  try {
    raw = res._getJSONData();
  } catch {
    const sent: unknown = res._getData();
    raw = typeof sent === 'object' && sent !== null ? sent : undefined;
  }

  const envelope =
    typeof raw === 'object' && raw !== null
      ? (raw as Record<string, unknown>)
      : undefined;

  return {
    status,
    event: typeof envelope?.event === 'string' ? envelope.event : undefined,
    data: envelope?.data as TData,
    raw,
  };
};
