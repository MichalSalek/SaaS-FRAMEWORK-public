import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/router';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { authClient } from '../../../application/auth/better-auth-client';
import { tearDownRejectedSessionTokenWithLock } from '../../../application/auth/auth-token-teardown';
import { detectPlatform } from '../../../application/platform/platform.detection';
import {
  hasResolvedNativeEntry,
  readNativeEntryToken,
} from '../../../application/lifecycle/native-entry-storage';
import {
  beginNativeStartup,
  classifyNativeSessionValidation,
  getNativeSessionErrorStatus,
  isNativeEntryBootstrapCandidate,
  isNativeStartupPlatform,
  isNativeStartupPending,
  NATIVE_STARTUP_TIMEOUT_MS,
} from '../../../application/lifecycle/native-startup';
import { NativeEntryBootstrapStatusComposition } from './NativeEntryBootstrapStatus.composition';
import {
  type NativeEntryStartupPhase,
  useNativeEntryBootstrapReadiness,
} from './useNativeEntryBootstrapReadiness';

type NativeEntryBootstrapProps = {
  children: ReactNode;
};

/** Holds native cold start until the stored bearer has a server verdict. */
export function NativeEntryBootstrapComposition({
  children,
}: NativeEntryBootstrapProps) {
  const router = useRouter();
  const pathname = router.pathname;
  const { replace } = router;
  const { data: session, isPending, isRefetching } = authClient.useSession();
  const [phase, setPhase] = useState<NativeEntryStartupPhase>('idle');
  const [target, setTarget] = useState<string | null>(null);
  const [validatedSession, setValidatedSession] =
    useState<typeof session>(null);
  const [validationVersion, setValidationVersion] = useState(0);
  const [manualRetrying, setManualRetrying] = useState(false);
  const startedRef = useRef(false);
  const requestedTokenRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const validatedTokenRef = useRef<string | null>(null);

  useNativeEntryBootstrapReadiness({
    phase,
    pathname,
    target,
    setPhase,
  });

  const navigateToResolvedEntry = useCallback(
    (route: string) => {
      setTarget(route);
      setPhase('navigating');
      void replace(route)
        .then(didNavigate => {
          if (!didNavigate) {
            // A cancelled route chunk/navigation is retryable. Keep the token and show the retry screen.
            setTarget(null);
            setPhase('unavailable');
          }
        })
        .catch(() => {
          // A route chunk/network failure is retryable. Keep the token and show the retry screen.
          setTarget(null);
          setPhase('unavailable');
        });
    },
    [replace]
  );

  useLayoutEffect(() => {
    if (
      !router.isReady ||
      startedRef.current ||
      typeof window === 'undefined'
    ) {
      return;
    }

    let detectedNative = false;
    try {
      detectedNative = detectPlatform().isNativeApp;
    } catch {
      // The wrapper query fallback below still identifies its launch if storage is blocked.
    }
    const isNativeApp = isNativeStartupPlatform(
      detectedNative,
      window.location.search
    );

    const candidate = isNativeEntryBootstrapCandidate({
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
      isNativeApp,
      entryResolved: hasResolvedNativeEntry(),
    });
    if (!candidate) {
      return;
    }

    startedRef.current = true;
    beginNativeStartup();
    const storedToken = readNativeEntryToken();
    if (!storedToken.available) {
      setPhase('unavailable');
      return;
    }
    if (storedToken.token === null) {
      navigateToResolvedEntry(ROUTES_FRONT.WELCOME);
      return;
    }

    setPhase('checking');
  }, [navigateToResolvedEntry, router.isReady]);

  useEffect(() => {
    if (router.isReady || startedRef.current || !isNativeStartupPending()) {
      return undefined;
    }

    // If Next never reports router readiness, release into the same retry screen instead of
    // holding the native splash indefinitely. The prepaint marker makes this timer safe to start.
    const timer = setTimeout(() => {
      if (!startedRef.current) {
        beginNativeStartup();
        setPhase('unavailable');
      }
    }, NATIVE_STARTUP_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [router.isReady]);

  // The initial Better Auth read is shared with AuthProvider. Once it settles, make one explicit
  // Bearer-bound validation request so a late 401 can never be attributed to a token stored after
  // that request began. This uses the existing auth-token-teardown exact-token guard on rejection.
  useEffect(() => {
    if (
      phase !== 'checking' ||
      ((isPending || isRefetching) && !manualRetrying) ||
      validatedTokenRef.current !== null
    ) {
      return;
    }

    const storedToken = readNativeEntryToken();
    if (!storedToken.available) {
      setManualRetrying(false);
      setPhase('unavailable');
      return;
    }
    const token = storedToken.token;
    if (token === null) {
      navigateToResolvedEntry(ROUTES_FRONT.WELCOME);
      return;
    }
    if (requestedTokenRef.current === token) {
      return;
    }

    requestedTokenRef.current = token;
    const requestId = ++requestIdRef.current;
    const settle = async (data: unknown, error: unknown) => {
      if (requestId !== requestIdRef.current) {
        return;
      }

      const currentToken = readNativeEntryToken();
      if (!currentToken.available) {
        setManualRetrying(false);
        setPhase('unavailable');
        return;
      }
      const verdict = classifyNativeSessionValidation({
        tokenAtRequest: token,
        liveToken: currentToken.token,
        hasSession: data !== null && data !== undefined,
        isPending: false,
        hasError: error !== null && error !== undefined,
        errorStatus: getNativeSessionErrorStatus(error),
      });

      if (verdict === 'stale-token') {
        requestedTokenRef.current = null;
        setManualRetrying(false);
        setPhase('checking');
        setValidationVersion(version => version + 1);
        return;
      }
      if (verdict === 'authenticated') {
        // Better Auth's hook reads the same atom. Hydrate it with this exact-token response before
        // allowing /app to mount so role-dependent guards see the validated identity immediately.
        const confirmedSession = data as NonNullable<typeof session>;
        authClient.hydrateSession(confirmedSession);
        validatedTokenRef.current = token;
        setValidatedSession(confirmedSession);
        setManualRetrying(false);
        return;
      }
      if (verdict === 'invalid') {
        setManualRetrying(false);
        const cleared = await tearDownRejectedSessionTokenWithLock({
          rejectedAuthorization: token,
        });
        if (!cleared || requestId !== requestIdRef.current) {
          return;
        }
        navigateToResolvedEntry(ROUTES_FRONT.WELCOME);
        return;
      }
      if (verdict === 'unauthenticated') {
        setManualRetrying(false);
        // A successful empty session routes to welcome, but null by itself never clears storage.
        navigateToResolvedEntry(ROUTES_FRONT.WELCOME);
        return;
      }
      if (verdict === 'unavailable') {
        setManualRetrying(false);
        setPhase('unavailable');
      }
    };

    void authClient
      .getSession({ fetchOptions: { auth: { type: 'Bearer', token } } })
      .then(result => settle(result.data, result.error))
      .catch(error => settle(null, error));
  }, [
    isPending,
    isRefetching,
    manualRetrying,
    navigateToResolvedEntry,
    phase,
    validationVersion,
  ]);

  // Wait until the atom has absorbed the explicitly validated session before mounting the app.
  useEffect(() => {
    const validatedToken = validatedTokenRef.current;
    if (
      phase !== 'checking' ||
      validatedToken === null ||
      validatedSession === null ||
      validatedSession === undefined
    ) {
      return;
    }

    const currentToken = readNativeEntryToken();
    if (!currentToken.available) {
      setPhase('unavailable');
      return;
    }
    if (currentToken.token !== validatedToken) {
      validatedTokenRef.current = null;
      setValidatedSession(null);
      requestedTokenRef.current = null;
      setValidationVersion(version => version + 1);
      return;
    }
    setManualRetrying(false);
    navigateToResolvedEntry(ROUTES_FRONT.APP);
  }, [navigateToResolvedEntry, phase, validatedSession, validationVersion]);

  useEffect(() => {
    if (phase !== 'checking' && phase !== 'navigating') {
      return undefined;
    }
    const timer = setTimeout(() => {
      // The retry screen owns the next decision. A timed-out validation must
      // not later clear the token or redirect while the user is on that screen.
      requestIdRef.current += 1;
      setManualRetrying(false);
      setPhase('unavailable');
    }, NATIVE_STARTUP_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const retryValidation = useCallback(() => {
    const storedToken = readNativeEntryToken();
    if (!storedToken.available) {
      setManualRetrying(false);
      return;
    }
    const token = storedToken.token;
    if (token === null) {
      navigateToResolvedEntry(ROUTES_FRONT.WELCOME);
      return;
    }

    // Invalidate any late response from the timed-out attempt; only this retry may decide entry.
    requestIdRef.current += 1;
    requestedTokenRef.current = null;
    validatedTokenRef.current = null;
    setValidatedSession(null);
    setManualRetrying(true);
    setPhase('checking');
    setValidationVersion(version => version + 1);
  }, [navigateToResolvedEntry]);

  if (phase === 'idle' || phase === 'settled') {
    return <>{children}</>;
  }
  if (phase === 'navigating' && target !== null && pathname === target) {
    return <>{children}</>;
  }

  return (
    <NativeEntryBootstrapStatusComposition
      phase={phase}
      isRetrying={manualRetrying}
      onRetry={retryValidation}
    />
  );
}
