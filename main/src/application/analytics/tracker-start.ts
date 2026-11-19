// application/analytics/tracker-start.ts
//
// DECISION: GTM (with gtag and the Clarity tag it loads) and PostHog (with its recorder) cost about
// half a second of main thread on a mid phone (Lighthouse blocking time). They start at the EARLIEST
// of: the first interaction (pointer, key, touch, wheel, scroll); the page going to the background;
// `load` + a quiet time + an idle moment. The quiet time applies only to public marketing and
// content pages (home, for-*, pricing, compare, about, blog, help, get-app, contact); it is 0
// elsewhere and when the URL carries the visit's source (utm, ad click ids).
// Cost on those pages without a source: a visitor who leaves within about four seconds of `load`
// without touching the page is not recorded; one who taps a link and leaves before GTM has loaded
// has no GA4 `page_view`, Clarity recording or PostHog autocapture of that tap (the landing
// `$pageview` and our own events are kept).
// Events fired before the start are not lost: the dataLayer is a queue GTM reads on arrival, and
// PostHog calls wait in `posthog-client.ts`. A landing page left before PostHog started gets its
// own `$pageview` (PostHogProvider), so funnels by landing page stay whole.

import {
  resolveQuietAfterLoadMs,
  TRACKER_START,
} from './tracker-start.helpers';

type Listener = () => void;

const INTERACTION_EVENTS = [
  'pointerdown',
  'keydown',
  'touchstart',
  'wheel',
  'scroll',
] as const;

let started = false;
let armed = false;
const listeners = new Set<Listener>();
const cleanups: Array<() => void> = [];

function start(): void {
  if (started) {
    return;
  }
  started = true;
  for (const cleanup of cleanups.splice(0, cleanups.length)) {
    cleanup();
  }
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // One tracker failing to start must not stop the others.
    }
  }
  listeners.clear();
}

function whenIdle(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(callback, {
      timeout: TRACKER_START.IDLE_TIMEOUT_MS,
    });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(callback, 1);
  return () => window.clearTimeout(handle);
}

function armTimer(): void {
  const quietMs = resolveQuietAfterLoadMs(
    window.location.pathname,
    window.location.search
  );
  let cancelIdle: (() => void) | undefined;
  let quietTimer: ReturnType<typeof setTimeout> | undefined;
  const afterLoad = (): void => {
    quietTimer = setTimeout(() => {
      cancelIdle = whenIdle(start);
    }, quietMs);
  };
  if (document.readyState === 'complete') {
    afterLoad();
  } else {
    window.addEventListener('load', afterLoad, { once: true });
    cleanups.push(() => window.removeEventListener('load', afterLoad));
  }
  cleanups.push(() => {
    if (quietTimer !== undefined) {
      clearTimeout(quietTimer);
    }
    cancelIdle?.();
  });
}

function arm(): void {
  if (armed) {
    return;
  }
  armed = true;
  const options: AddEventListenerOptions = { capture: true, passive: true };
  for (const type of INTERACTION_EVENTS) {
    window.addEventListener(type, start, options);
    cleanups.push(() => window.removeEventListener(type, start, options));
  }
  const onHidden = (): void => {
    if (document.visibilityState === 'hidden') {
      start();
    }
  };
  document.addEventListener('visibilitychange', onHidden);
  cleanups.push(() =>
    document.removeEventListener('visibilitychange', onHidden)
  );
  armTimer();
}

/**
 * Runs `listener` once the trackers may start (at once when they already may).
 * Returns an unsubscribe for a component that unmounts before that.
 */
export function onTrackersMayStart(listener: Listener): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  if (started) {
    listener();
    return () => {};
  }
  listeners.add(listener);
  arm();
  return () => {
    listeners.delete(listener);
  };
}

/** Whether the gate is already open. */
export function haveTrackersStarted(): boolean {
  return started;
}

/** Test seam: close the gate again. */
export function resetTrackerStartForTests(): void {
  for (const cleanup of cleanups.splice(0, cleanups.length)) {
    cleanup();
  }
  started = false;
  armed = false;
  listeners.clear();
}
