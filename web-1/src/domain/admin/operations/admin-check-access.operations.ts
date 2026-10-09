/**
 * Admin check-access operations
 *
 * GET: Health check (server ID + timestamp)
 * POST: URL access check (validates + fetches external URL)
 */

import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type { ValidationError } from '@kernel/application/common-errors.types';
import type {
  AdminInsufficientPermissionsError,
  UrlAccessForbiddenError,
  UrlAccessNetworkError,
} from '@kernel/domain/admin/admin-errors.types';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';

const creationDate = new Date();
const SERVER_ID = `${creationDate.toISOString()}-${Math.random().toString(36).slice(2)}`;

const ALLOWED_DOMAINS = [
  'api.github.com',
  'httpbin.org',
  'jsonplaceholder.typicode.com',
];

const isValidUrl = (url: string): boolean => {
  try {
    const urlObj = new URL(url);
    if (urlObj.protocol !== 'https:') {
      return false;
    }

    // Anty-SSRF defense-in-depth: blokada hostow prywatnych/loopback/link-local
    // PRZED allowlista. Dzis allowlist publicznych domen i tak by je odrzucil,
    // ale ten blok MUSI stac pierwszy — gdy ALLOWED_DOMAINS sie rozszerzy
    // (np. o wildcard/konfigurowalne wpisy), prywatne adresy pozostana
    // odrzucone niezaleznie od zawartosci listy.
    const hostname = urlObj.hostname;
    if (
      hostname === 'localhost' ||
      hostname.startsWith('127.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
      hostname.startsWith('169.254.') ||
      hostname === '::1' ||
      hostname.startsWith('fc00:') ||
      hostname.startsWith('fe80:')
    ) {
      return false;
    }

    if (!ALLOWED_DOMAINS.includes(hostname)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
};

// ─── GET: Health check ───────────────────────────────────────────────────

type CheckAccessHealthSuccess = {
  serverId: string;
  timestamp: string;
};

const CHECK_ACCESS_BODY_MAX_BYTES = 64 * 1024;

/** Read at most `maxBytes` of the body, then stop the stream. */
const readCappedText = async (
  response: Response,
  maxBytes: number
): Promise<string> => {
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const merged = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const slice = chunk.subarray(0, merged.length - offset);
    merged.set(slice, offset);
    offset += slice.byteLength;
    if (offset >= merged.length) {
      break;
    }
  }
  return new TextDecoder().decode(merged);
};

export const checkAccessHealth_IO = async ({
  currentUser,
}: {
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<
  OperationResult<CheckAccessHealthSuccess, AdminInsufficientPermissionsError>
> => {
  // Guard parity: kazda operacja admin egzekwuje requireAdminPermission na
  // wejsciu (defense-in-depth obok permission wiringu middleware) — te dwie
  // operacje byly jedynym wyjatkiem.
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  return success({
    serverId: SERVER_ID,
    timestamp: new Date().toISOString(),
  });
};

// ─── POST: URL access check ─────────────────────────────────────────────

type CheckAccessUrlError =
  | AdminInsufficientPermissionsError
  | ValidationError
  | UrlAccessForbiddenError
  | UrlAccessNetworkError;

type CheckAccessUrlSuccess = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: unknown;
};

export const checkAccessUrl_IO = async ({
  url,
  currentUser,
}: {
  url: string | undefined;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<OperationResult<CheckAccessUrlSuccess, CheckAccessUrlError>> => {
  // Guard parity — patrz komentarz w checkAccessHealth_IO.
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  if (!url) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'url',
      message: 'URL is required',
    });
  }

  if (!isValidUrl(url)) {
    return failure({ type: 'CHECK_ACCESS_URL_FORBIDDEN' });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    });
    // The 5 s budget covers the BODY too (testy-api s34): clearing the timer on
    // headers let a slow drip hold the request ~10 s. The body is also capped, so
    // a large page never lands whole in the admin response.
    const raw = await readCappedText(response, CHECK_ACCESS_BODY_MAX_BYTES);
    clearTimeout(timeoutId);

    const data = (() => {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return raw;
      }
    })();

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return success({
      status: response.status,
      statusText: response.statusText,
      headers,
      data,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    const isAbort = error instanceof Error && error.name === 'AbortError';
    return failure({
      type: 'CHECK_ACCESS_URL_NETWORK',
      reason: isAbort ? 'TIMEOUT' : 'FETCH_FAILED',
    });
  }
};
