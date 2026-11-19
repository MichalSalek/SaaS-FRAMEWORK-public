// domain/notifications/push/web-push.ts
// Web push on the phone's browser (and on a laptop): the service worker,
// the subscription and its registration with the backend.
//
// DECISION:
// The worker (`public/sw.js`) does push and nothing else; it is registered
// lazily, only for a signed-in person inside /app (domain/notifications/push/push.controller.ts), never
// on a public page. The permission prompt is NEVER automatic: it runs inside
// `subscribeWebPush`, called from the opt-in control only. A subscription the
// browser already holds is re-sent on start (`syncWebPushSubscription`), so a
// rotated endpoint or a device moving to another account is corrected without
// the person doing anything. iOS shows web push only to a home-screen app
// (standalone manifest is already there); Safari in a tab reports unsupported.

import { ENV_VARS } from '../../../application/environment/environment.config';
import {
  registerPushSubscription_IO,
  unregisterPushSubscription_IO,
} from '../notificationsIO.possibilities.api';
import { reportIssueFrontend } from '../../../application/error-debugger/errorHandler.possibilities.api';
import {
  readSubscriptionFields,
  urlBase64ToUint8Array,
  type PushPermissionState,
} from './push.state';

const SERVICE_WORKER_URL = '/sw.js';

const REGISTER_TIMEOUT_MS = 8_000;
// The FIRST subscribe of a browser profile registers it with the push
// service and was measured at over 15 s (it then completes anyway); the
// button shows its loading state meanwhile, so the bound is generous.
const SUBSCRIBE_TIMEOUT_MS = 60_000;

const withTimeout = <T>(work: Promise<T>, timeoutMs: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${String(timeoutMs)} ms`)),
      timeoutMs
    );
    work.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });

export const getWebPushPublicKey = (): string | null => {
  const key = ENV_VARS.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY;
  return key && key.length > 0 ? key : null;
};

export const isWebPushSupported = (): boolean =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window &&
  getWebPushPublicKey() !== null;

export const getWebPushPermission = (): PushPermissionState => {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }
  return Notification.permission;
};

const getRegistration = async (
  strict = false
): Promise<ServiceWorkerRegistration | null> => {
  if (!isWebPushSupported()) {
    return null;
  }
  try {
    const existing = await withTimeout(
      navigator.serviceWorker.getRegistration(SERVICE_WORKER_URL),
      REGISTER_TIMEOUT_MS
    );
    if (!existing) {
      await withTimeout(
        navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: '/' }),
        REGISTER_TIMEOUT_MS
      );
    }
    // A worker that is still installing cannot take a subscription (measured
    // on the first tap of a fresh profile: subscribe failed, the second tap
    // worked), so the push calls always wait for the ACTIVE registration.
    return await withTimeout(
      navigator.serviceWorker.ready,
      REGISTER_TIMEOUT_MS
    );
  } catch (error) {
    reportIssueFrontend({
      namespace: 'WEB_PUSH_SW_REGISTER',
      message: error instanceof Error ? error.message : 'service worker failed',
      payload: null,
      mode: 'warn',
    });
    if (strict) {
      throw error;
    }
    return null;
  }
};

export const getWebPushSubscription = async (
  strict = false
): Promise<PushSubscription | null> => {
  const registration = await getRegistration(strict);
  if (!registration) {
    return null;
  }
  try {
    return await withTimeout(
      registration.pushManager.getSubscription(),
      REGISTER_TIMEOUT_MS
    );
  } catch (error) {
    if (strict) {
      throw error;
    }
    return null;
  }
};

const sendToBackend = async (
  subscription: PushSubscription
): Promise<boolean> => {
  const fields = readSubscriptionFields(subscription);
  if (!fields) {
    return false;
  }
  await registerPushSubscription_IO(
    { platform: 'WEBPUSH', ...fields },
    { silentBusinessError: true }
  );
  return true;
};

export type SubscribeOutcome = 'subscribed' | 'denied' | 'failed';

/**
 * The opt-in: asks for the permission (the ONLY place that does), subscribes
 * with the VAPID key and registers the device. Returns what happened so the
 * control can say it in place.
 */
export const subscribeWebPush = async (): Promise<SubscribeOutcome> => {
  const key = getWebPushPublicKey();
  if (!isWebPushSupported() || key === null) {
    return 'failed';
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return 'denied';
  }
  const registration = await getRegistration();
  if (!registration) {
    return 'failed';
  }
  try {
    const subscription =
      (await withTimeout(
        registration.pushManager.getSubscription(),
        REGISTER_TIMEOUT_MS
      )) ??
      (await withTimeout(
        registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key),
        }),
        SUBSCRIBE_TIMEOUT_MS
      ));
    return (await sendToBackend(subscription)) ? 'subscribed' : 'failed';
  } catch (error) {
    reportIssueFrontend({
      namespace: 'WEB_PUSH_SUBSCRIBE',
      message: error instanceof Error ? error.message : 'subscribe failed',
      payload: null,
      mode: 'warn',
    });
    return 'failed';
  }
};

/** On start, when the permission is already granted: re-send what the browser holds. */
export const syncWebPushSubscription = async (): Promise<void> => {
  if (getWebPushPermission() !== 'granted') {
    return;
  }
  const subscription = await getWebPushSubscription();
  if (subscription) {
    try {
      await sendToBackend(subscription);
    } catch {
      // best-effort: the next start retries
    }
  }
};

/** Switch-off on this device, and logout: the backend forgets the endpoint first. */
export const unsubscribeWebPush = async (): Promise<void> => {
  const subscription = await getWebPushSubscription();
  if (!subscription) {
    return;
  }
  try {
    await unregisterPushSubscription_IO(
      { endpoint: subscription.endpoint },
      { silentBusinessError: true }
    );
  } catch {
    // the backend copy is swept later; the local one still goes
  }
  try {
    await subscription.unsubscribe();
  } catch {
    // nothing to keep
  }
};
