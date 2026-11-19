import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { TIME } from '@kernel/application/constants.config';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { ENV_VARS } from '@app/environment/environment.config';

const CACHE_TTL_MS = TIME.MS_PER_DAY;
const MIN_GAP_MS = 1000;
const MAX_CACHE_ENTRIES = 256;
const MAX_PENDING = 16;
const MAX_QUEUE_WAIT_MS = 15_000;

type CacheEntry = { label: string | null; expiresAt: number };
type FetchOutcome = { ok: true; label: string | null } | { ok: false };

type PendingJob = {
  start: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type NominatimState = {
  cache: Map<string, CacheEntry>;
  inflight: Map<string, Promise<string | null>>;
  pending: PendingJob[];
  running: boolean;
  wakeTimer: ReturnType<typeof setTimeout> | null;
  lastUpstreamAt: number;
};
const globalScope = globalThis as typeof globalThis & {
  __nailfolioNominatim?: NominatimState;
};
// DECISION: Next bundles API routes separately. A module-local queue would let search and reverse
// each spend the same upstream request budget, so both use this process-wide state.
const state = (globalScope.__nailfolioNominatim ??= {
  cache: new Map(),
  inflight: new Map(),
  pending: [],
  running: false,
  wakeTimer: null,
  lastUpstreamAt: 0,
});
const { cache, inflight } = state;

/** Nominatim requires an identifying application name and a contact, not a generic library UA. */
export const nominatimUserAgent = (): string =>
  `${BRAND_CONFIG.name} (${BRAND_CONFIG.domain}; ${BRAND_CONFIG.email.contact})`;

/** A runtime server setting allows changing to another compatible provider without a new app build. */
export const nominatimEndpoint = (path: 'search' | 'reverse'): string => {
  const base =
    ENV_VARS.GEOCODING_API_URL || 'https://nominatim.openstreetmap.org/';
  return new URL(path, base.endsWith('/') ? base : `${base}/`).href;
};

export const roundPairCoordinate = (value: number): number | null => {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * 100) / 100;
};

type NominatimAddress = {
  city?: string;
  town?: string;
  village?: string;
  suburb?: string;
  city_district?: string;
};

const firstText = (...values: Array<string | undefined>): string => {
  for (const value of values) {
    const trimmed = value?.trim() ?? '';
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return '';
};

/**
 * City or town plus a district. A village stays the village alone.
 * No locality is an empty result, not an error string.
 */
export const formatNominatimPlace = (
  address: NominatimAddress | undefined
): string | null => {
  if (address == null) {
    return null;
  }
  const city = firstText(address.city, address.town);
  const village = firstText(address.village);
  if (city.length === 0) {
    return village.length > 0 ? village : null;
  }
  const district = firstText(address.suburb, address.city_district);
  if (district.length === 0 || district === city) {
    return city;
  }
  const combined = `${city}, ${district}`;
  return combined.length <= 60 ? combined : city;
};

const remember = (key: string, label: string | null): void => {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, { label, expiresAt: Date.now() + CACHE_TTL_MS });
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    cache.delete(oldest);
  }
};

/** Queue rejection is a transient unavailable result, never a cacheable miss. */
export class NominatimQueueUnavailableError extends Error {
  constructor() {
    super('Nominatim queue unavailable');
    this.name = 'NominatimQueueUnavailableError';
  }
}

const pump = (): void => {
  if (state.running || state.wakeTimer !== null || state.pending.length === 0) {
    return;
  }
  const delay = Math.max(0, MIN_GAP_MS - (Date.now() - state.lastUpstreamAt));
  if (delay > 0) {
    state.wakeTimer = setTimeout(() => {
      state.wakeTimer = null;
      pump();
    }, delay);
    return;
  }
  const job = state.pending.shift();
  if (!job) {
    return;
  }
  clearTimeout(job.timer);
  state.running = true;
  state.lastUpstreamAt = Date.now();
  job.start();
};

export const enqueueNominatim = <T>(work: () => Promise<T>): Promise<T> => {
  if (state.pending.length >= MAX_PENDING) {
    return Promise.reject(new NominatimQueueUnavailableError());
  }
  return new Promise<T>((resolve, reject) => {
    const job: PendingJob = {
      reject,
      timer: setTimeout(() => {
        const index = state.pending.indexOf(job);
        if (index < 0) {
          return;
        }
        state.pending.splice(index, 1);
        reject(new NominatimQueueUnavailableError());
        if (state.pending.length === 0 && state.wakeTimer !== null) {
          clearTimeout(state.wakeTimer);
          state.wakeTimer = null;
        }
      }, MAX_QUEUE_WAIT_MS),
      start: () => {
        void Promise.resolve()
          .then(work)
          .then(resolve, reject)
          .finally(() => {
            state.running = false;
            pump();
          });
      },
    };
    state.pending.push(job);
    pump();
  });
};

const fetchReverse = async (
  latitude: number,
  longitude: number
): Promise<FetchOutcome> => {
  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: String(latitude),
    lon: String(longitude),
    zoom: '14',
    addressdetails: '1',
  });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(
      `${nominatimEndpoint('reverse')}?${params.toString()}`,
      {
        headers: { 'User-Agent': nominatimUserAgent() },
        signal: controller.signal,
      }
    );
    if (!response.ok) {
      reportIssueBackend({
        namespace: 'geocoding',
        mode: 'error',
        message: 'Reverse geocoding failed',
        payload: { status: response.status },
      });
      return { ok: false };
    }
    const data: unknown = await response.json();
    const address =
      data !== null && typeof data === 'object' && 'address' in data
        ? (data.address as NominatimAddress)
        : undefined;
    return { ok: true, label: formatNominatimPlace(address) };
  } catch {
    reportIssueBackend({
      namespace: 'geocoding',
      mode: 'error',
      message: 'Reverse geocoding failed',
      payload: null,
    });
    return { ok: false };
  } finally {
    clearTimeout(timeoutId);
  }
};

/**
 * Reverse geocode already-coarse coordinates. The key is the rounded pair, the
 * cache lasts 24h, and upstream calls are serialised to at least one second
 * apart. A cache hit does not occupy that slot. Coordinates are not logged.
 */
export const reverseNominatimPlace = async (
  latitude: number,
  longitude: number
): Promise<string | null> => {
  const roundedLat = roundPairCoordinate(latitude);
  const roundedLon = roundPairCoordinate(longitude);
  if (
    roundedLat === null ||
    roundedLon === null ||
    roundedLat < -90 ||
    roundedLat > 90 ||
    roundedLon < -180 ||
    roundedLon > 180
  ) {
    return null;
  }
  const key = `${roundedLat.toFixed(2)},${roundedLon.toFixed(2)}`;
  const cached = cache.get(key);
  if (cached !== undefined && cached.expiresAt > Date.now()) {
    return cached.label;
  }
  const pending = inflight.get(key);
  if (pending !== undefined) {
    return pending;
  }
  const job = enqueueNominatim(() => fetchReverse(roundedLat, roundedLon))
    .then(outcome => {
      if (outcome.ok) {
        remember(key, outcome.label);
        return outcome.label;
      }
      return null;
    })
    .catch(error => {
      if (error?.name === 'NominatimQueueUnavailableError') {
        return null;
      }
      throw error;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, job);
  return job;
};

/** Test-only reset of the in-process cache and the upstream queue. */
export const resetNominatimSchedulerForTests = (): void => {
  cache.clear();
  inflight.clear();
  for (const job of state.pending.splice(0)) {
    clearTimeout(job.timer);
    job.reject(new NominatimQueueUnavailableError());
  }
  if (state.wakeTimer !== null) {
    clearTimeout(state.wakeTimer);
  }
  state.wakeTimer = null;
  state.running = false;
  state.lastUpstreamAt = 0;
};
