import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';

export const NATIVE_STARTUP_PENDING_ATTRIBUTE = 'data-native-startup-pending';
export const NATIVE_STARTUP_READY_EVENT = 'nf:native-startup-ready';
export const NATIVE_STARTUP_TIMEOUT_MS = 10_000;

const EXPLICIT_TARGET_PARAMS = [
  'authCode',
  'code',
  'qr',
  'qrCode',
  'qr_code',
  'target',
  'redirect',
  'redirectTo',
  'returnTo',
  'next',
] as const;

export interface NativeEntryCandidate {
  pathname: string;
  search: string;
  hash: string;
  isNativeApp: boolean;
  entryResolved: boolean;
}

export function isNativeStartupPlatform(
  detectedNative: boolean,
  search: string
): boolean {
  if (detectedNative) {
    return true;
  }
  const platform = new URLSearchParams(search).get('platform');
  return platform === 'android' || platform === 'ios';
}

export function isNativeEntryBootstrapCandidate({
  pathname,
  search,
  hash,
  isNativeApp,
  entryResolved,
}: NativeEntryCandidate): boolean {
  if (!isNativeApp || entryResolved || hash !== '') {
    return false;
  }

  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const isHome = path === ROUTES_FRONT.HOME || path === '/en' || path === '/de';
  if (!isHome) {
    return false;
  }

  const params = new URLSearchParams(search);
  return !EXPLICIT_TARGET_PARAMS.some(param => params.has(param));
}

export type NativeSessionVerdict =
  | 'pending'
  | 'authenticated'
  | 'unauthenticated'
  | 'invalid'
  | 'unavailable'
  | 'stale-token';

export function getNativeSessionErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return null;
  }
  const status = error.status;
  return typeof status === 'number' ? status : null;
}

export interface NativeSessionValidation {
  tokenAtRequest: string | null;
  liveToken: string | null;
  hasSession: boolean;
  isPending: boolean;
  hasError: boolean;
  errorStatus: number | null;
}

export function classifyNativeSessionValidation({
  tokenAtRequest,
  liveToken,
  hasSession,
  isPending,
  hasError,
  errorStatus,
}: NativeSessionValidation): NativeSessionVerdict {
  if (isPending) {
    return 'pending';
  }

  // An answer for an older token must not decide the fate of a newer login.
  if (tokenAtRequest !== liveToken && liveToken !== null) {
    return 'stale-token';
  }
  if (liveToken === null) {
    return 'unauthenticated';
  }
  if (hasError) {
    return errorStatus === 401 ? 'invalid' : 'unavailable';
  }
  return hasSession ? 'authenticated' : 'unauthenticated';
}

let startupPending = false;

/** Keep the native splash visible while the remote app decides the initial screen. */
export function beginNativeStartup(): void {
  startupPending = true;
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute(
      NATIVE_STARTUP_PENDING_ATTRIBUTE,
      'true'
    );
  }
}

/** Notify AppLifecycle that a final screen or a retry screen has rendered. */
export function completeNativeStartup(): void {
  startupPending = false;
  if (typeof document !== 'undefined') {
    document.documentElement.removeAttribute(NATIVE_STARTUP_PENDING_ATTRIBUTE);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(NATIVE_STARTUP_READY_EVENT));
  }
}

/** Let React commit the resolved route before the native splash begins fading away. */
export function scheduleNativeStartupReady(): void {
  let completed = false;
  const releaseSplash = () => {
    if (completed) {
      return;
    }
    completed = true;
    completeNativeStartup();
  };
  window.requestAnimationFrame(releaseSplash);

  window.setTimeout(releaseSplash, 500);
}

export function isNativeStartupPending(): boolean {
  return (
    startupPending ||
    (typeof document !== 'undefined' &&
      document.documentElement.getAttribute(
        NATIVE_STARTUP_PENDING_ATTRIBUTE
      ) === 'true')
  );
}

/** Run once the startup gate has rendered its resolved screen; call immediately for normal routes. */
export function onNativeStartupReady(callback: () => void): () => void {
  if (typeof window === 'undefined' || !isNativeStartupPending()) {
    callback();
    return () => undefined;
  }

  const handleReady = () => {
    if (isNativeStartupPending()) {
      return;
    }
    window.removeEventListener(NATIVE_STARTUP_READY_EVENT, handleReady);
    callback();
  };
  window.addEventListener(NATIVE_STARTUP_READY_EVENT, handleReady);
  // Recheck after subscribing so a same-tick completion cannot be missed.
  handleReady();
  return () =>
    window.removeEventListener(NATIVE_STARTUP_READY_EVENT, handleReady);
}
