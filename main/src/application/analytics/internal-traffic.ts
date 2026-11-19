import {
  hasInternalTrafficCookie,
  INTERNAL_TRAFFIC_COOKIE,
  parseInternalTrafficOverride,
} from './internal-traffic.helpers';
import {
  getLocalStorage,
  setLocalStorage,
} from '../client-device-storage/local-storage-adapter/localStorage.adapter';
import { STORAGE_KEYS } from '../client-device-storage/storage-keys.config';

const INTERNAL_TRAFFIC_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/**
 * DECISION: own traffic is NOT measured at all (owner). The cookie `nf_internal=1` is
 * the one switch and it closes three gates:
 *  - `public/analytics-bootstrap.js` loads no GTM, GA4 or Clarity;
 *  - `PostHogProvider` does not initialise PostHog;
 *  - `emitAnalyticsEvent` / `clarity()` send nothing.
 * The GTM rule that reads the cookie stays as a second line; nothing should reach it.
 * Ways to set the cookie: `?nf_internal=1` (off: `?nf_internal=0`), a master admin session,
 * impersonation, the production test contexts.
 */

export function isInternalTrafficEnabled(): boolean {
  return (
    typeof document !== 'undefined' && hasInternalTrafficCookie(document.cookie)
  );
}

export function setInternalTrafficCookie(enabled: boolean): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.cookie = enabled
    ? `${INTERNAL_TRAFFIC_COOKIE}=1; Path=/; Max-Age=${INTERNAL_TRAFFIC_MAX_AGE_SECONDS}; SameSite=Lax`
    : `${INTERNAL_TRAFFIC_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  if (enabled) {
    silenceRunningTrackers();
  }
}

interface RunningTrackersWindow {
  gtag?: (...args: unknown[]) => void;
  clarity?: (...args: unknown[]) => void;
}

/**
 * The cookie can appear AFTER the trackers of this page have loaded (an admin
 * logs in, an impersonation starts). From the next page load nothing loads;
 * for the rest of this one the running trackers are told to stop. Each call is
 * best effort: a tracker that was never loaded is simply not there. PostHog is
 * stopped by its own owners (`PostHogProvider`, `usePostHogIdentify`): this
 * module is imported by `_app` and must not pull `posthog-js` into its chunk.
 */
export function silenceRunningTrackers(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const w = window as unknown as RunningTrackersWindow;
  try {
    w.gtag?.('consent', 'update', {
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'denied',
    });
  } catch {
    // A blocked gtag is already silent.
  }
  try {
    w.clarity?.('stop');
  } catch {
    // Clarity that never loaded has nothing to stop.
  }
}

export function setInternalTrafficCookieForMasterAdmin(): void {
  try {
    if (getLocalStorage(STORAGE_KEYS.INTERNAL_TRAFFIC_OVERRIDE) === '0') {
      setInternalTrafficCookie(false);
      return;
    }
  } catch {
    // Automatic admin marking remains best-effort when browser storage is blocked.
  }
  setInternalTrafficCookie(true);
}

export function applyInternalTrafficOverrideFromUrl(): void {
  if (typeof window === 'undefined') {
    return;
  }

  const override = parseInternalTrafficOverride(window.location.search);
  if (override === null) {
    return;
  }

  // DECISION: an explicit nf_internal=0 persists the device's choice, so a master admin can switch
  // off the exclusion of their own traffic despite the automatic marking of admin sessions.
  try {
    setLocalStorage(
      STORAGE_KEYS.INTERNAL_TRAFFIC_OVERRIDE,
      override ? '1' : '0'
    );
  } catch {
    // The cookie remains the analytics source of truth for the current page.
  }
  setInternalTrafficCookie(override);

  try {
    const url = new URL(window.location.href);
    url.searchParams.delete(INTERNAL_TRAFFIC_COOKIE);
    const cleaned = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, '', cleaned);
  } catch {
    // A cookie override must not block the page if an embedded history API fails.
  }
}
