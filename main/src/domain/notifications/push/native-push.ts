// domain/notifications/push/native-push.ts
// Android push through the wrapper's `PushNotifications` plugin (FCM).
//
// DECISION:
// Addressed with `registerPlugin<T>('PushNotifications')`, NOT the npm package
// (the three-step rule of NATIVE_INTEGRATION_GUIDE §The remote-origin bridge:
// the implementation lives in the wrapper, the id must be in
// EXPOSED_PLUGIN_IDS, and main/package.json gets nothing). The proxy is a
// thenable, so it is always handed over wrapped in an object (`{ plugin }`),
// never returned bare from an async function (haptics.ts has the measurement).
// Without `google-services.json` in the wrapper `register()` ends in
// `registrationError`, which is swallowed: the device simply has no push.

import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import type { PushPermissionState } from './push.state';

type PermissionStatus = {
  receive: 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied';
};
export type PluginListenerHandle = { remove: () => Promise<void> };
type ActionPerformed = {
  notification: { data?: Record<string, unknown> | undefined };
};

export interface PushNotificationsPlugin {
  checkPermissions(): Promise<PermissionStatus>;
  requestPermissions(): Promise<PermissionStatus>;
  register(): Promise<void>;
  unregister(): Promise<void>;
  addListener(
    eventName: 'registration',
    listener: (token: { value: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'registrationError',
    listener: (error: { error: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'pushNotificationReceived',
    listener: (notification: unknown) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'pushNotificationActionPerformed',
    listener: (action: ActionPerformed) => void
  ): Promise<PluginListenerHandle>;
}

const PLUGIN_ID = 'PushNotifications';

export async function getPlugin(): Promise<{
  plugin: PushNotificationsPlugin;
} | null> {
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) {
      return null;
    }
    if (!Capacitor.isPluginAvailable(PLUGIN_ID)) {
      return null;
    }
    const plugin = registerPlugin<PushNotificationsPlugin>(PLUGIN_ID);
    return { plugin };
  } catch {
    return null;
  }
}

export const isNativePushAvailable = async (): Promise<boolean> =>
  (await getPlugin()) !== null;

const toPermissionState = (status: PermissionStatus): PushPermissionState => {
  if (status.receive === 'granted') {
    return 'granted';
  }
  if (status.receive === 'denied') {
    return 'denied';
  }
  return 'prompt';
};

export const getNativePushPermission =
  async (): Promise<PushPermissionState> => {
    const handle = await getPlugin();
    if (!handle) {
      throw new Error('Native push plugin unavailable during permission read');
    }
    return toPermissionState(await handle.plugin.checkPermissions());
  };

/**
 * Listeners for the life of the app page: a received push (the page refreshes its bell)
 * and a tap (the page navigates to the notification centre).
 */
export const attachNativePushListeners = async (callbacks: {
  onReceived: () => void;
  onOpen: (url: string) => void;
}): Promise<() => void> => {
  const handle = await getPlugin();
  if (!handle) {
    return () => undefined;
  }
  const { plugin } = handle;
  const handles: PluginListenerHandle[] = [];
  try {
    handles.push(
      await plugin.addListener('pushNotificationReceived', () => {
        callbacks.onReceived();
      })
    );
    handles.push(
      await plugin.addListener('pushNotificationActionPerformed', action => {
        const url = action.notification.data?.['url'];
        callbacks.onOpen(
          typeof url === 'string' ? url : ROUTES_FRONT.NOTIFICATIONS
        );
      })
    );
  } catch {
    // a listener that cannot attach leaves the others in place
  }
  return () => {
    handles.forEach(h => void h.remove());
  };
};
