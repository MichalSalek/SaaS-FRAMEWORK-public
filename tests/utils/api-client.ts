/**
 * API Test Client - SSOT for API testing
 *
 * Minimal client for smoke tests. Comprehensive testing done by AI agent.
 */

import { TEST_CONFIG } from '../config/test.config';

export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export type ApiCallOptions = {
  endpoint: string;
  token?: string | undefined;
  method?: HTTPMethod | undefined;
  body?: Record<string, unknown> | undefined;
  headers?: Record<string, string> | undefined;
};

export type ApiResponse<T = unknown> = {
  status: number;
  headers: Record<string, string>;
  body: T;
  raw: Response;
};

/** Standard API response envelope: { event: string, data: T } */
export type ApiDataBody<T = unknown> = { event: string; data: T };

/** Extract typed data from standard API response envelope {event, data} */
export function getData<T>(response: ApiResponse): T {
  const body = response.body as ApiDataBody<T>;
  if (!body || typeof body !== 'object' || !('data' in body)) {
    throw new Error(
      `Expected API envelope {data: T}, got: ${JSON.stringify(response.body).slice(0, 200)}`
    );
  }
  return body.data;
}

/** Extract event string from standard API response envelope */
export function getEvent(response: ApiResponse): string {
  return (response.body as ApiDataBody).event;
}

/**
 * Sleep utility for rate limit handling
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Per-request rate limiter — ensures min delay between requests
 * Rate limit: 100 req/10s = 10 req/s → 150ms between requests (safe margin)
 */
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 150;

/**
 * Make API call with retry logic for rate limits
 */
export const apiCall = async <T = unknown>(
  { endpoint, token, method = 'GET', body, headers = {} }: ApiCallOptions,
  retries = TEST_CONFIG.RATE_LIMIT.MAX_RETRIES
): Promise<ApiResponse<T>> => {
  // Enforce minimum interval between requests
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
  }
  lastRequestTime = Date.now();

  const url = `${TEST_CONFIG.API_URL}${endpoint}`;

  const requestHeaders: Record<string, string> = {
    Origin: TEST_CONFIG.ORIGIN,
    'Content-Type': 'application/json',
    ...headers,
  };

  // M9 r28: dev-login wymaga x-internal-secret gdy INTERNAL_SHARED_SECRET jest
  // skonfigurowany (defense-in-depth). Testy wołające dev-login bezpośrednio przez
  // apiCall (nie getDevLoginToken) też go potrzebują — inaczej 404 DEV_LOGIN_BLOCKED.
  // Centralnie tutaj, by pokryć wszystkie ~26 ad-hoc wywołań w smoke testach.
  if (endpoint.includes('/api/auth/dev-login') && TEST_CONFIG.INTERNAL_SECRET) {
    requestHeaders['x-internal-secret'] = TEST_CONFIG.INTERNAL_SECRET;
  }

  if (token) {
    requestHeaders['authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : null,
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    const reason = error instanceof Error ? error.message : String(error);
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    throw new Error(
      `API call failed: ${method} ${url} — ${isTimeout ? 'Request timed out after 10s' : reason}. ` +
        `Check if backend is running and reachable.`
    );
  } finally {
    clearTimeout(timeoutId);
  }

  // Handle rate limit with retry
  if (response.status === 429 && retries > 0) {
    // X-RateLimit-Reset is an epoch timestamp (seconds). Compute delay from now.
    const resetEpoch = parseInt(
      response.headers.get('x-ratelimit-reset') || '0',
      10
    );
    const nowSec = Math.ceil(Date.now() / 1000);
    const delay =
      resetEpoch > nowSec
        ? (resetEpoch - nowSec) * 1000 + 500
        : TEST_CONFIG.RATE_LIMIT.RETRY_DELAY;

    console.log(
      `⏳ Rate limit hit, retrying in ${delay}ms... (${retries} retries left)`
    );
    await sleep(delay);

    return apiCall({ endpoint, token, method, body, headers }, retries - 1);
  }

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  let responseBody: T;
  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    responseBody = (await response.json()) as T;
  } else {
    responseBody = (await response.text()) as unknown as T;
  }

  return {
    status: response.status,
    headers: responseHeaders,
    body: responseBody,
    raw: response,
  };
};

/**
 * Mint a brand-new dev-login session (DEVELOPMENT only).
 * Wraps the /api/auth/dev-login endpoint directly. Internal — tests go through
 * getDevLoginToken (cached) or getFreshDevLoginToken (forced mint).
 *
 * r28: token is no longer in response body (SafeCurrentUser strips session.token).
 * Token is issued via 'authorization' response header (out-of-band, set by setClientHeader).
 */
const mintDevLoginToken = async (email: string): Promise<string> => {
  // M9 r28: dev-login wymaga x-internal-secret gdy INTERNAL_SHARED_SECRET jest
  // skonfigurowany (defense-in-depth, /web-1/src/pages/api/auth/dev-login/index.ts).
  // Mirror main/src/proxy.ts — wysyłamy sekret gdy dostępny w env. Ustaw go, jeśli
  // backend wymaga sekretu.
  const devLoginHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Origin: TEST_CONFIG.ORIGIN,
  };
  if (TEST_CONFIG.INTERNAL_SECRET) {
    devLoginHeaders['x-internal-secret'] = TEST_CONFIG.INTERNAL_SECRET;
  }

  const response = await fetch(`${TEST_CONFIG.API_URL}/api/auth/dev-login`, {
    method: 'POST',
    headers: devLoginHeaders,
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    throw new Error(
      `DEV_LOGIN failed: ${response.status} ${response.statusText}`
    );
  }

  const token = response.headers.get('authorization');
  if (!token) {
    throw new Error('No authorization header in DEV_LOGIN response');
  }
  return token;
};

// Per-email token cache. Every dev-login call mints a NEW Session row in the DB;
// smoke suites used to re-mint dozens of times per run for the SAME shared test
// users (fresh* locals everywhere), flooding the Session table (audit 2026-07-11:
// test-stylist had 616 rows, 609 expired). One session per email per run is enough
// — the 48h TTL outlives any test run. Cached as Promise so concurrent first calls
// dedupe to a single mint; a failed mint evicts itself (no poisoned cache).
// NOTE: deliberately NO logout-teardown — test users are shared with parallel
// human/agent sessions; a teardown would kill those sessions too.
const devLoginTokenCache = new Map<string, Promise<string>>();

/**
 * Get a dev-login token for any email (DEVELOPMENT only) — CACHED per email.
 * Use role-specific aliases (getStylistToken, getAdminToken, getClientToken)
 * for tests that need semantic clarity. If a test may have invalidated the
 * cached session (impersonation, session-revoke), use getFreshDevLoginToken.
 */
export const getDevLoginToken = async (email: string): Promise<string> => {
  const cached = devLoginTokenCache.get(email);
  if (cached) {
    return cached;
  }
  const pending = mintDevLoginToken(email);
  devLoginTokenCache.set(email, pending);
  pending.catch(() => {
    // Identity-check: odrzucony STARY promise nie może skasować świeżo
    // podmienionego (getFreshDevLoginToken) dobrego wpisu (review S50b #3).
    if (devLoginTokenCache.get(email) === pending) {
      devLoginTokenCache.delete(email);
    }
  });
  return pending;
};

/**
 * Force-mint a FRESH dev-login session, bypassing the cache. For tests whose
 * flow can invalidate/replace the current session (admin impersonation) or that
 * explicitly need a session distinct from the shared cached one. The fresh
 * token also REPLACES the cache entry — it is the newest known-valid session,
 * so later cached calls self-heal after a session-mutating test.
 */
export const getFreshDevLoginToken = async (email: string): Promise<string> => {
  const pending = mintDevLoginToken(email);
  devLoginTokenCache.set(email, pending);
  pending.catch(() => {
    // Identity-check: odrzucony STARY promise nie może skasować świeżo
    // podmienionego (getFreshDevLoginToken) dobrego wpisu (review S50b #3).
    if (devLoginTokenCache.get(email) === pending) {
      devLoginTokenCache.delete(email);
    }
  });
  return pending;
};

/**
 * Extract bearer session token from apiCall response.
 * r28: session.token removed from body (SafeCurrentUser/SafeSession), token only in 'authorization' header.
 */
export const extractSessionToken = <T>(response: ApiResponse<T>): string => {
  const token = response.headers['authorization'];
  if (!token) {
    throw new Error(
      'No authorization header in response — login endpoint should set it via setClientHeader'
    );
  }
  return token;
};

/**
 * Get stylist token via DEV_LOGIN (default: STYLIST_MAIN test user).
 */
export const getStylistToken = async (
  email: string = TEST_CONFIG.USERS.STYLIST_MAIN
): Promise<string> => getDevLoginToken(email);

/**
 * Get a FRESH (uncached) stylist session token — for tests that need a session
 * distinct from the shared cached one.
 */
export const getFreshStylistToken = async (
  email: string = TEST_CONFIG.USERS.STYLIST_MAIN
): Promise<string> => getFreshDevLoginToken(email);

/**
 * Get admin token via DEV_LOGIN (default: ADMIN_MAIN test user).
 */
export const getAdminToken = async (
  email = TEST_CONFIG.USERS.ADMIN_MAIN
): Promise<string> => getDevLoginToken(email);

/**
 * Get a FRESH (uncached) admin session token — for flows that can invalidate or
 * replace the admin session (become-user / switch-back impersonation).
 */
export const getFreshAdminToken = async (
  email = TEST_CONFIG.USERS.ADMIN_MAIN
): Promise<string> => getFreshDevLoginToken(email);

/**
 * Get client token via DEV_LOGIN (default: CLIENT_MAIN test user).
 */
export const getClientToken = async (): Promise<string> =>
  getDevLoginToken(TEST_CONFIG.USERS.CLIENT_MAIN);

// ============================================================================
// CONCURRENCY HARNESS (KROK 4 — LIVE race suite, tests/concurrency/)
//
// apiCall() above is WRONG for concurrency tests: the 150ms serializing gate
// (lastRequestTime) + 429-backoff retry turn "fire N simultaneously" into "fire
// N spaced 150ms apart, each retried" — a guaranteed FALSE GREEN (the race never
// happens, so the bug never reproduces). apiCallRaw is a SEPARATE path (ATI-5):
// no gate, no retry, single fetch. fireParallel adds a start-barrier so all N
// requests leave the client within microseconds, maximizing the overlap window
// on the server. This is NOT a flag on apiCall — keeping them separate makes it
// impossible to accidentally serialize a race test.
// ============================================================================

// Server rate limit is 100 req/10s per IP over a SHARED non-strict bucket. apiCallRaw
// MUST NOT gate during a race (that recreates the false-green apiCall serializes). But
// SETUP/standalone calls (token mint, seed-via-API, sequential deterministic steps) fired
// back-to-back across 17 tests overflow that shared window → spurious 429 on setup. So:
//   gate=true (DEFAULT): pace at 150ms min-interval (~6.6/s < 10/s limit) + bounded 429
//     backoff. Used for every standalone apiCallRaw call in a family file's setup.
//   gate=false: no pace, no retry — used by fireParallel for the actual race burst.
// The 150ms gate on standalone calls keeps the shared window well under 100/10s so the
// (small, ungated) race bursts never find a full window.
const sleepMs = (ms: number): Promise<void> =>
  new Promise(r => setTimeout(r, ms));

// Client-side mirror of the server's sliding window (100 req / 10s per IP, shared
// non-strict bucket). EVERY apiCallRaw — gated setup AND ungated race — records a
// timestamp here. Before a GATED (setup) call we wait until the window has a free
// slot under a SAFETY CAP (< limit), so setup never saturates the bucket and the
// (ungated, small) race bursts always find headroom. Race calls never block on the
// window (that would re-serialize them) — they only contribute to the count, so the
// gated calls around them back off correctly.
const SERVER_WINDOW_MS = 10_000;
const WINDOW_SAFETY_CAP = 75; // leave ~25 headroom under the 100/10s server limit
const reqWindow: number[] = [];
const pruneWindow = (now: number): void => {
  while (
    reqWindow.length > 0 &&
    now - (reqWindow[0] as number) >= SERVER_WINDOW_MS
  ) {
    reqWindow.shift();
  }
};
const recordReq = (): void => {
  reqWindow.push(Date.now());
};
/** Block until fewer than `cap` requests sit in the trailing 10s window. */
const awaitWindowSlot = async (cap: number): Promise<void> => {
  for (;;) {
    const now = Date.now();
    pruneWindow(now);
    if (reqWindow.length < cap) {
      return;
    }
    const oldest = reqWindow[0] as number;
    await sleepMs(SERVER_WINDOW_MS - (now - oldest) + 25);
  }
};

/**
 * Single concurrency-suite API call. Mirrors apiCall's request shaping (Origin,
 * Content-Type, bearer, dev-login secret). gate=true (default) paces + retries 429
 * for setup calls; gate=false (races, via fireParallel) fires raw — no pace, no retry.
 */
/**
 * Ile razy gated-call absorbuje 429 i jak długo najwyżej czeka.
 *
 * Komentarz przy retry obiecywał „ograniczone: ponów raz", ale rekurencja
 * wołała samą siebie bez licznika — czyli pętla bez końca. Póki serwer nie
 * podawał `Retry-After`, backoff spadał do 1 s i sonda dobijała się co sekundę;
 * odkąd limity domenowe podają uczciwe okno (nawet godzinę), ta sama pętla
 * spałaby godzinę zamiast oddać 429 wołającemu. Test, który trafia w limit
 * długookresowy, ma dostać odpowiedź do asercji, a nie zawisnąć.
 */
const GATED_429_MAX_ATTEMPTS = 2;
const GATED_429_MAX_BACKOFF_MS = 30_000;

export const apiCallRaw = async <T = unknown>(
  { endpoint, token, method = 'GET', body, headers = {} }: ApiCallOptions,
  opts: { gate?: boolean; attempt?: number } = {}
): Promise<ApiResponse<T>> => {
  const gate = opts.gate !== false;
  const attempt = opts.attempt ?? 1;
  if (gate) {
    await awaitWindowSlot(WINDOW_SAFETY_CAP);
  }
  recordReq();

  const url = `${TEST_CONFIG.API_URL}${endpoint}`;
  const requestHeaders: Record<string, string> = {
    Origin: TEST_CONFIG.ORIGIN,
    'Content-Type': 'application/json',
    ...headers,
  };
  if (endpoint.includes('/api/auth/dev-login') && TEST_CONFIG.INTERNAL_SECRET) {
    requestHeaders['x-internal-secret'] = TEST_CONFIG.INTERNAL_SECRET;
  }
  if (token) {
    requestHeaders['authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : null,
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    const reason = error instanceof Error ? error.message : String(error);
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    throw new Error(
      `apiCallRaw failed: ${method} ${url} — ${isTimeout ? 'timed out after 15s' : reason}.`
    );
  } finally {
    clearTimeout(timeoutId);
  }

  // Gated (setup) calls absorb a transient 429 — never the race itself.
  // Ograniczone DWOMA licznikami: liczbą prób i długością czekania (patrz
  // GATED_429_MAX_ATTEMPTS). Odmowa z limitu liczonego w godzinach wraca do
  // wołającego jako zwykłe 429, żeby dało się na nim asertować.
  if (gate && response.status === 429 && attempt < GATED_429_MAX_ATTEMPTS) {
    const retryAfter = Number(
      (response.headers.get('retry-after') ||
        response.headers.get('x-ratelimit-reset-after') ||
        '1') as string
    );
    const backoffMs =
      (Number.isFinite(retryAfter) ? retryAfter : 1) * 1000 + 250;
    if (backoffMs <= GATED_429_MAX_BACKOFF_MS) {
      await sleepMs(backoffMs);
      return apiCallRaw<T>(
        { endpoint, token, method, body, headers },
        { gate: true, attempt: attempt + 1 }
      );
    }
  }

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  let responseBody: T;
  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    responseBody = (await response.json()) as T;
  } else {
    responseBody = (await response.text()) as unknown as T;
  }

  return {
    status: response.status,
    headers: responseHeaders,
    body: responseBody,
    raw: response,
  };
};

/**
 * Fire N requests as simultaneously as the event loop allows, via a start
 * barrier. Each task is created up-front and parks on a shared promise; once all
 * are parked we resolve the barrier so they leave together — far tighter overlap
 * than a bare Promise.all (which still awaits each builder's sync prelude in
 * order). Never throws: every task is settled, network errors become a synthetic
 * status:0 response so the caller can assert on the full set.
 *
 * @param specs request options (length = concurrency)
 * @returns settled responses in the SAME order as specs
 */
export const fireParallel = async <T = unknown>(
  specs: ApiCallOptions[]
): Promise<ApiResponse<T>[]> => {
  // Wait for the rolling window to have room for the WHOLE burst BEFORE the
  // synchronized release. This preserves true parallelism (all N still leave
  // together once released) while guaranteeing the burst cannot push the server's
  // 100/10s window over the cap — the missing piece that let ungated bursts
  // saturate the bucket and 429 a later family's setup.
  await awaitWindowSlot(Math.max(1, WINDOW_SAFETY_CAP - specs.length));

  let release!: () => void;
  const barrier = new Promise<void>(resolve => {
    release = resolve;
  });

  const tasks = specs.map(spec =>
    barrier.then(() =>
      apiCallRaw<T>(spec, { gate: false }).catch((err): ApiResponse<T> => ({
        status: 0,
        headers: {},
        body: {
          __error: err instanceof Error ? err.message : String(err),
        } as unknown as T,
        raw: undefined as unknown as Response,
      }))
    )
  );

  // Let every task reach its barrier.then() await point before releasing.
  await Promise.resolve();
  release();
  return Promise.all(tasks);
};

/** Convenience: fire the SAME request `count` times in parallel. */
export const fireParallelSame = <T = unknown>(
  spec: ApiCallOptions,
  count: number
): Promise<ApiResponse<T>[]> =>
  fireParallel<T>(Array.from({ length: count }, () => ({ ...spec })));

// ============================================================================
// ASSERTIONS (Minimal - for smoke tests only)
// ============================================================================

export const assert = {
  equals: (actual: unknown, expected: unknown, message?: string) => {
    if (actual !== expected) {
      throw new Error(message || `Expected ${expected}, got ${actual}`);
    }
  },

  status: (response: ApiResponse, expectedStatus: number, message?: string) => {
    if (response.status !== expectedStatus) {
      throw new Error(
        message ||
          `Expected status ${expectedStatus}, got ${response.status}. Body: ${JSON.stringify(response.body)}`
      );
    }
  },

  success: (
    response: ApiResponse & { body: { event?: string } },
    message?: string
  ) => {
    if (response.status !== 200 && response.status !== 201) {
      throw new Error(
        message ||
          `Expected success status, got ${response.status}. Event: ${response.body.event}`
      );
    }
  },

  hasProperty: (
    obj: Record<string, unknown>,
    property: string,
    message?: string
  ) => {
    if (!(property in obj)) {
      throw new Error(message || `Expected property "${property}" in object`);
    }
  },
};
