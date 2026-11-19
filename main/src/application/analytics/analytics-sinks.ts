import { capturePosthog } from './posthog-client';
import { DATA_LAYER_PROPERTY_KEYS } from './analytics-contract';
import { resolvePageKind } from './analytics-page-kind';
import { isInternalTrafficEnabled } from './internal-traffic';

interface DataLayerWindow extends Window {
  dataLayer?: Record<string, unknown>[];
}

export type AnalyticsEventProps = Record<
  string,
  string | number | boolean | undefined
>;

/** One event reaches both analytics sinks without blocking the user action. */
export function emitAnalyticsEvent(
  name: string,
  props: AnalyticsEventProps,
  identity?: { uuid: string; timestamp: Date }
): void {
  // Own traffic is not measured (DECISION in internal-traffic.ts).
  if (typeof window === 'undefined' || isInternalTrafficEnabled()) {
    return;
  }

  const enriched: AnalyticsEventProps = {
    ...props,
    page_kind: resolvePageKind(window.location.pathname),
  };

  try {
    if (identity) {
      capturePosthog(name, enriched, identity);
    } else {
      capturePosthog(name, enriched);
    }
  } catch {
    // PostHog can be unavailable while GTM is still usable.
  }

  try {
    const w = window as DataLayerWindow;
    w.dataLayer = w.dataLayer ?? [];
    const dataLayerEvent: Record<string, unknown> = {
      event: name,
      ...enriched,
    };
    for (const key of DATA_LAYER_PROPERTY_KEYS) {
      dataLayerEvent[key] = props[key];
    }
    w.dataLayer.push(dataLayerEvent);
  } catch {
    // A blocked dataLayer must not interrupt the action being measured.
  }
}

// DECISION: Clarity tagging lives in app code because the production CSP blocks inline GTM tags on
// SSG pages.
type ClarityFn = ((...args: unknown[]) => void) & { q?: unknown[][] };

export function clarity(...args: unknown[]): void {
  if (typeof window === 'undefined' || isInternalTrafficEnabled()) {
    return;
  }
  const w = window as unknown as { clarity?: ClarityFn };
  if (!w.clarity) {
    const stub: ClarityFn = (...queued: unknown[]) => {
      (stub.q ??= []).push(queued);
    };
    w.clarity = stub;
  }
  try {
    w.clarity(...args);
  } catch {
    // Clarity tagging is best-effort and must never interrupt a user action.
  }
}
