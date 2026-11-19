import type { LifecycleEntryContext } from '@kernel/models/email/email.dto';
import {
  getLocalStorage,
  setLocalStorage,
} from '../client-device-storage/local-storage-adapter/localStorage.adapter';
import { STORAGE_KEYS } from '../client-device-storage/storage-keys.config';
import { useCookieConsentStore } from '../stores/cookieConsent.store';
import { usePostHogReadinessStore } from './posthog-readiness.store';
import { isInternalTrafficEnabled } from './internal-traffic';
import type { AnalyticsEventProps } from './analytics-sinks';

const DAY = 86400000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Pending = {
  messageId: string;
  ctaId: string;
  entryId: string;
  capturedAt: number;
};
type StoredAttribution = LifecycleEntryContext & { ownerId: string };

function read<T>(key: string): T | null {
  try {
    const raw = getLocalStorage(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown): void {
  try {
    setLocalStorage(key, JSON.stringify(value));
  } catch {
    /* Navigation must survive blocked storage. */
  }
}
export function readPendingLifecycle(now = Date.now()): Pending | null {
  const pending = read<Pending>(STORAGE_KEYS.EMAIL_LIFECYCLE_PENDING);
  return pending &&
    UUID.test(pending.messageId) &&
    UUID.test(pending.entryId) &&
    /^[a-z][a-z0-9_-]{0,63}$/.test(pending.ctaId) &&
    Number.isSafeInteger(pending.capturedAt) &&
    now >= pending.capturedAt &&
    now - pending.capturedAt <= 7 * DAY
    ? pending
    : null;
}

/** Runs before router/login redirects; uses its own storage, never first-touch acquisition. */
export function captureLifecycleFromUrl(raw = window.location.href): void {
  const url = new URL(raw, window.location.origin);
  const messageId = url.searchParams.get('nf_message');
  const ctaId = url.searchParams.get('nf_cta');
  if (
    !messageId ||
    !UUID.test(messageId) ||
    !ctaId ||
    !/^[a-z][a-z0-9_-]{0,63}$/.test(ctaId)
  ) {
    return;
  }
  const existing = readPendingLifecycle();
  // The same landing after refresh/auth is the same visit. A later explicit link to
  // another message starts a new visit; page loads alone never emit a click.
  if (existing?.messageId === messageId && existing.ctaId === ctaId) {
    return;
  }
  write(STORAGE_KEYS.EMAIL_LIFECYCLE_PENDING, {
    messageId,
    ctaId,
    entryId: crypto.randomUUID(),
    capturedAt: Date.now(),
  });
}
export function appendLifecycleToCallback(callback: string): string {
  const pending = readPendingLifecycle();
  if (!pending) {
    return callback;
  }
  const url = new URL(callback, window.location.origin);
  url.searchParams.set('nf_message', pending.messageId);
  url.searchParams.set('nf_cta', pending.ctaId);
  return url.toString();
}
export function saveLifecycleAttribution(
  context: LifecycleEntryContext,
  ownerId: string
): void {
  write(STORAGE_KEYS.EMAIL_LIFECYCLE_ATTRIBUTION, { ...context, ownerId });
}
export function lifecycleTrackingAllowed(ownerId: string): boolean {
  return (
    useCookieConsentStore.getState().consent?.analytics !== false &&
    !isInternalTrafficEnabled() &&
    usePostHogReadinessStore.getState().identifiedUserId === ownerId
  );
}
export function lifecycleDimensions(
  context: LifecycleEntryContext
): AnalyticsEventProps {
  return {
    lifecycle_message_id: context.messageId,
    lifecycle_entry_id: context.entryId,
    lifecycle_cta: context.ctaId,
    lifecycle_family: context.family,
    lifecycle_rule: context.ruleId,
    lifecycle_template: context.templateId,
    lifecycle_locale: context.locale,
    lifecycle_cohort: context.cohort,
    lifecycle_transport: context.provider ?? 'unknown',
  };
}
export function lifecycleActionProperties(
  now = Date.now()
): AnalyticsEventProps {
  const context = read<StoredAttribution>(
    STORAGE_KEYS.EMAIL_LIFECYCLE_ATTRIBUTION
  );
  if (!context || !lifecycleTrackingAllowed(context.ownerId)) {
    return {};
  }
  const elapsed = now - Date.parse(context.enteredAt);
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 7 * DAY) {
    return {};
  }
  return {
    ...lifecycleDimensions(context),
    lifecycle_within_24h: elapsed <= DAY,
    lifecycle_within_7d: true,
  };
}

let entryValidation: Promise<unknown> | null = null;
export function setLifecycleEntryValidation(pending: Promise<unknown>): void {
  entryValidation = pending;
  void pending.finally(() => {
    if (entryValidation === pending) {
      entryValidation = null;
    }
  });
}

/** Only analytics waits for ownership validation; the user's action never waits. */
export function withLifecycleActionProperties(
  emit: (properties: AnalyticsEventProps) => void
): void {
  const observedAt = Date.now();
  const pending = entryValidation;
  if (!pending) {
    emit(lifecycleActionProperties(observedAt));
    return;
  }
  let sent = false;
  const finish = () => {
    if (sent) {
      return;
    }
    sent = true;
    clearTimeout(timer);
    emit(lifecycleActionProperties(observedAt));
  };
  const timer = setTimeout(finish, 5000);
  void pending.then(finish, finish);
}

export function waitForLifecycleEntryValidation(): Promise<unknown> {
  return entryValidation ?? Promise.resolve();
}
