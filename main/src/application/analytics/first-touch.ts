import { appendLifecycleToCallback } from './email-lifecycle';
import { TIME } from '@kernel/application/constants.config';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import {
  deleteLocalStorage,
  getLocalStorage,
  setLocalStorage,
} from '../client-device-storage/local-storage-adapter/localStorage.adapter';
import { getFromClientStorage } from '../client-device-storage/clientStorage.possibilities.api';
import { STORAGE_KEYS } from '../client-device-storage/storage-keys.config';
import {
  appendFirstTouchToCallback,
  isPublicFirstTouchPath,
  parseFirstTouch,
  resolveFirstTouchSource,
  type FirstTouchMethod,
  type FirstTouchValues,
} from './first-touch.helpers';
import {
  applyInternalTrafficOverrideFromUrl,
  setInternalTrafficCookie,
} from './internal-traffic';

export const FIRST_TOUCH_TTL_MS = 30 * TIME.MS_PER_DAY;

interface StoredFirstTouch extends FirstTouchValues {
  capturedAt: number;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function parseStoredFirstTouch(
  raw: string | null,
  now: number
): StoredFirstTouch | null {
  if (raw === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) {
      return null;
    }
    const capturedAt = parsed['capturedAt'];
    const src = parsed['src'];
    const landing = parsed['landing'];
    const cta = parsed['cta'];
    const method = parsed['method'];
    if (
      typeof capturedAt !== 'number' ||
      !Number.isSafeInteger(capturedAt) ||
      now < capturedAt ||
      now - capturedAt > FIRST_TOUCH_TTL_MS ||
      typeof src !== 'string' ||
      src.length === 0 ||
      typeof landing !== 'string' ||
      landing.length === 0 ||
      (cta !== undefined && typeof cta !== 'string') ||
      (method !== undefined && method !== 'magic_link' && method !== 'google')
    ) {
      return null;
    }

    return {
      capturedAt,
      src,
      landing,
      ...(typeof cta === 'string' ? { cta } : {}),
      ...(method === 'magic_link' || method === 'google' ? { method } : {}),
    };
  } catch {
    return null;
  }
}

function writeFirstTouch(record: StoredFirstTouch): void {
  try {
    setLocalStorage(STORAGE_KEYS.FIRST_TOUCH, JSON.stringify(record));
  } catch {
    // Attribution is best-effort and must not interrupt navigation or signup.
  }
}

export function readFirstTouch(
  now: number = Date.now()
): StoredFirstTouch | null {
  let raw: string | null = null;
  try {
    raw = getLocalStorage(STORAGE_KEYS.FIRST_TOUCH);
  } catch {
    return null;
  }

  const record = parseStoredFirstTouch(raw, now);
  if (raw !== null && record === null) {
    try {
      deleteLocalStorage(STORAGE_KEYS.FIRST_TOUCH);
    } catch {
      // Expired or malformed attribution can be ignored if storage is read-only.
    }
  }
  return record;
}

function removeFirstTouchParamFromUrl(): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('nf_ft');
    const cleaned = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, '', cleaned);
  } catch {
    // The captured value remains usable even if this embedded history API fails.
  }
}

export function captureFirstTouchFromUrl(now: number = Date.now()): void {
  if (typeof window === 'undefined') {
    return;
  }

  const callbackValue = new URLSearchParams(window.location.search).get(
    'nf_ft'
  );
  let record = readFirstTouch(now);

  if (callbackValue !== null) {
    if (record === null) {
      const values = parseFirstTouch(callbackValue);
      if (values !== null) {
        record = { ...values, capturedAt: now };
        writeFirstTouch(record);
      }
    }
    removeFirstTouchParamFromUrl();
  }

  if (record !== null || !isPublicFirstTouchPath(window.location.pathname)) {
    return;
  }

  const values: FirstTouchValues = {
    src: resolveFirstTouchSource({
      search: window.location.search,
      referrer: document.referrer,
      currentOrigin: window.location.origin,
    }),
    landing: window.location.pathname,
  };
  writeFirstTouch({ ...values, capturedAt: now });
}

export function captureAnalyticsUrlStateFromUrl(): void {
  if (typeof window === 'undefined') {
    return;
  }

  applyInternalTrafficOverrideFromUrl();
  const becomeToken = getFromClientStorage({ key: CUSTOM_HEADERS.becomeUser });
  if (becomeToken !== null && becomeToken !== '') {
    setInternalTrafficCookie(true);
  }
  captureFirstTouchFromUrl();
}

export function updateFirstTouch(fields: {
  cta?: string;
  method?: FirstTouchMethod;
}): void {
  let current = readFirstTouch();
  if (current === null && typeof window !== 'undefined') {
    captureFirstTouchFromUrl();
    current = readFirstTouch();
  }
  if (current === null) {
    return;
  }

  writeFirstTouch({
    ...current,
    ...fields,
  });
}

export function appendFirstTouchToCallbackURL(
  callbackURL: string,
  method: FirstTouchMethod
): string {
  updateFirstTouch({ method });
  const record = readFirstTouch();
  return appendLifecycleToCallback(
    record === null
      ? callbackURL
      : appendFirstTouchToCallback(callbackURL, record)
  );
}

export function getFirstTouchEventProperties(): {
  first_source: string | undefined;
  first_landing: string | undefined;
  first_cta: string | undefined;
  method: FirstTouchMethod | undefined;
} {
  const record = readFirstTouch();
  return {
    first_source: record?.src,
    first_landing: record?.landing,
    first_cta: record?.cta,
    method: record?.method,
  };
}

export function getFirstTouchPersonProperties(): Record<string, string> {
  const record = readFirstTouch();
  if (record === null) {
    return {};
  }

  return {
    first_source: record.src,
    first_landing: record.landing,
    ...(record.cta !== undefined ? { first_cta: record.cta } : {}),
  };
}
