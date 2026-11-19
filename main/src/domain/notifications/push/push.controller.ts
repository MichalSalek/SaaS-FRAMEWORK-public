// domain/notifications/push/push.controller.ts
// The two React seams of push: the controller that runs on every app screen
// for a signed-in person (mounted by the app-bar bell, the one component with
// exactly that lifetime), and the opt-in state a control renders.

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/router';
import { isAppZonePath } from '@kernel/domain/routing/app-path.utils';
import { queryKeys } from '../../../application/http/queryKeys.factory';
import { trackFlowStep } from '../../../application/analytics/flow-events';
import { detectPlatform } from '../../../application/platform/platform.detection';
import { AUTH_IDENTITY_WILL_CHANGE_EVENT } from '../../../application/auth/auth-token-teardown';
import {
  attachNativePushListeners,
  getNativePushPermission,
  isNativePushAvailable,
} from './native-push';
import {
  invalidateNativePushWork,
  getNativePushRegistrationState,
  subscribeNativePush,
  syncNativePush,
  unsubscribeNativePush,
} from './native-push-lifecycle';
import { NATIVE_PUSH_STATE_EVENT } from './native-push-state';
import {
  getWebPushPermission,
  getWebPushSubscription,
  isWebPushSupported,
  subscribeWebPush,
  syncWebPushSubscription,
  unsubscribeWebPush,
} from './web-push';
import { resolvePushOptInStatus, type PushOptInStatus } from './push.state';
import { handlePushOpenMessage, resolvePushRoute } from './push-open';

/**
 * Runs once per app page life for a signed-in, active person: re-sends a
 * subscription the device already holds, listens for pushes (refresh the
 * bell) and taps (go to the notification centre). Never prompts.
 */
export function usePushController(enabled: boolean): void {
  const queryClient = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }
    if (!isAppZonePath(window.location.pathname)) {
      return;
    }
    const refreshBell = () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.all,
      });
    };
    const navigate = (path: string, locale: string | undefined) => {
      void router.push(path, undefined, locale ? { locale } : undefined);
    };
    const open = (url: string) => {
      const route = resolvePushRoute(url, window.location.href);
      navigate(route.path, route.locale);
    };

    let disposeWeb = () => undefined as void;
    let disposeNative = () => undefined as void;
    let cancelled = false;
    const invalidateIdentity = () => invalidateNativePushWork();
    window.addEventListener(
      AUTH_IDENTITY_WILL_CHANGE_EVENT,
      invalidateIdentity
    );

    if (detectPlatform().isNativeApp) {
      void attachNativePushListeners({ onReceived: refreshBell, onOpen: open })
        .then(dispose => {
          if (cancelled) {
            dispose();
          } else {
            disposeNative = dispose;
          }
        })
        .then(() => {
          if (!cancelled) {
            return syncNativePush();
          }
          return undefined;
        });
    } else if (isWebPushSupported()) {
      const handleMessage = (event: MessageEvent<unknown>) => {
        if (
          typeof event.data === 'object' &&
          event.data !== null &&
          'type' in event.data &&
          event.data.type === 'nf-push-received'
        ) {
          refreshBell();
        } else {
          handlePushOpenMessage(
            event.data,
            window.location.href,
            navigate,
            () => {
              event.ports[0]?.postMessage({ type: 'nf-push-ready' });
            }
          );
        }
      };
      navigator.serviceWorker.addEventListener('message', handleMessage);
      disposeWeb = () =>
        navigator.serviceWorker.removeEventListener('message', handleMessage);
      void syncWebPushSubscription();
    }
    return () => {
      cancelled = true;
      window.removeEventListener(
        AUTH_IDENTITY_WILL_CHANGE_EVENT,
        invalidateIdentity
      );
      invalidateNativePushWork();
      disposeWeb();
      disposeNative();
    };
  }, [enabled, queryClient, router]);
}

export type PushOptIn = {
  status: PushOptInStatus;
  /** True while the status is being read or changed. */
  busy: boolean;
  /** Last change failed (the control says so in place). */
  failed: boolean;
  /** The current device status could not be read. */
  readFailed: boolean;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
};

/**
 * What the „Powiadomienia na tym urządzeniu” control shows and does. The
 * status is read on mount (permission + subscription), `enable` is the ONLY
 * caller of the permission prompt.
 */
export function usePushOptIn(): PushOptIn {
  const [status, setStatus] = useState<PushOptInStatus>('unknown');
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [removalPending, setRemovalPending] = useState(false);

  const readStatus = useCallback(async () => {
    if (typeof window === 'undefined') {
      return;
    }
    const native = detectPlatform().isNativeApp;
    if (native) {
      const supported = await isNativePushAvailable();
      const permission = supported ? await getNativePushPermission() : 'denied';
      const registration = supported
        ? await getNativePushRegistrationState()
        : { subscribed: false, removalPending: false };
      setRemovalPending(registration.removalPending);
      setStatus(
        resolvePushOptInStatus({
          supported,
          permission,
          subscribed: registration.subscribed,
        })
      );
      return;
    }
    const supported = isWebPushSupported();
    const subscription = supported ? await getWebPushSubscription(true) : null;
    setStatus(
      resolvePushOptInStatus({
        supported,
        permission: getWebPushPermission(),
        subscribed: subscription !== null,
      })
    );
  }, []);

  const read = useCallback(async () => {
    try {
      await readStatus();
      setReadFailed(false);
    } catch (error) {
      setReadFailed(true);
      throw error;
    }
  }, [readStatus]);

  useEffect(() => {
    let active = true;
    void read()
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setBusy(false);
        }
      });
    return () => {
      active = false;
    };
  }, [read]);

  useEffect(() => {
    const refresh = () => {
      void read().catch(() => undefined);
    };
    window.addEventListener(NATIVE_PUSH_STATE_EVENT, refresh);
    return () => window.removeEventListener(NATIVE_PUSH_STATE_EVENT, refresh);
  }, [read]);

  const enable = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    trackFlowStep('notifications', 'push_prompted');
    try {
      const outcome = detectPlatform().isNativeApp
        ? await subscribeNativePush()
        : await subscribeWebPush();
      if (outcome === 'subscribed') {
        trackFlowStep('notifications', 'push_subscribed');
      } else if (outcome === 'denied') {
        trackFlowStep('notifications', 'push_denied');
      } else {
        trackFlowStep('notifications', 'push_failed');
        setFailed(true);
      }
      await read();
    } catch {
      trackFlowStep('notifications', 'push_failed');
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [read]);

  const disable = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      if (detectPlatform().isNativeApp) {
        if (!(await unsubscribeNativePush())) {
          setFailed(true);
          await read();
          return;
        }
      } else {
        await unsubscribeWebPush();
      }
      trackFlowStep('notifications', 'push_unsubscribed');
      await read();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [read]);

  return {
    status,
    busy,
    failed: failed || removalPending,
    readFailed,
    enable,
    disable,
  };
}
