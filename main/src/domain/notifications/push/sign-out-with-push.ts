// domain/notifications/push/sign-out-with-push.ts
// The logout sequence with the push device: this browser must stop receiving
// this account's pushes, and the backend accepts that only with the bearer
// token still in place, so the unregister runs BEFORE sign-out. Both steps
// are bounded, so an unreachable backend never hangs the logout (the local
// teardown in AuthContext stays the authoritative logout regardless).

import { unsubscribeWebPush } from './web-push';
import { detectPlatform } from '../../../application/platform/platform.detection';
import { forgetNativePushDevice } from './native-push-lifecycle';

const bounded = <T>(work: Promise<T>, timeoutMs: number): Promise<T | void> =>
  Promise.race([
    work,
    new Promise<void>(resolve => {
      setTimeout(resolve, timeoutMs);
    }),
  ]);

export const signOutAndForgetPushDevice = async (
  signOut: () => Promise<unknown>
): Promise<void> => {
  try {
    await bounded(
      detectPlatform().isNativeApp
        ? forgetNativePushDevice()
        : unsubscribeWebPush(),
      1500
    );
  } catch {
    // Device removal is best-effort; it must not skip session revocation.
  }
  await bounded(signOut(), 2500);
};
