// domain/notifications/push/push.state.ts
// Pure pieces of the push client: the opt-in status a control renders and the
// VAPID key conversion. No browser APIs here, so they are unit-testable.

/**
 * What the „Powiadomienia na tym urządzeniu” control shows.
 *  - unknown: the first read has not completed or failed;
 *  - unsupported: no push on this platform or no public key configured;
 *  - off: allowed to ask, nothing registered yet;
 *  - denied: the browser or the system blocked it; only its settings can undo;
 *  - on: this device is registered.
 */
export type PushOptInStatus =
  'unknown' | 'unsupported' | 'off' | 'denied' | 'on';

export type PushPermissionState = 'default' | 'granted' | 'denied' | 'prompt';

export const resolvePushOptInStatus = (input: {
  supported: boolean;
  permission: PushPermissionState;
  subscribed: boolean;
}): PushOptInStatus => {
  if (!input.supported) {
    return 'unsupported';
  }
  if (input.permission === 'denied') {
    return 'denied';
  }
  if (input.permission === 'granted' && input.subscribed) {
    return 'on';
  }
  return 'off';
};

/** The VAPID public key as the ArrayBuffer `pushManager.subscribe` wants. */
export const urlBase64ToUint8Array = (
  base64Url: string
): Uint8Array<ArrayBuffer> => {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
};

/** `PushSubscription.toJSON()` fields the backend stores. */
export type WebPushSubscriptionFields = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export const readSubscriptionFields = (subscription: {
  endpoint: string;
  toJSON: () => { keys?: Record<string, string> | undefined };
}): WebPushSubscriptionFields | null => {
  const keys = subscription.toJSON().keys;
  const p256dh = keys?.['p256dh'];
  const auth = keys?.['auth'];
  if (!p256dh || !auth) {
    return null;
  }
  return { endpoint: subscription.endpoint, p256dh, auth };
};
