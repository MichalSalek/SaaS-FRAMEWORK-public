// Leave-guard host, mounted once in `_app` next to the navigation controller:
//   1. renders the ONE "leave without saving?" dialog (AppDialogAtom, in
//      LeaveGuardPromptDialog.organism) for the prompt held by
//      application/routing/leave-guard.ts;
//   2. installs the push/replace seam on the real Next router instance, the
//      only place every push-origin navigation passes through (AppLinkAtom,
//      useNativeRouter after its own pre-check, raw router.push/replace,
//      redirections.ts). Mechanism: DECISION in leave-guard.ts.
// Router EVENTS stay with NavigationTransitionController (O18); this file
// never subscribes to them.

import { useEffect, useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import Router, { useRouter } from 'next/router';
import { noteScrollOption } from './history-scroll';
import {
  getLeavePrompt,
  requestLeave,
  resolveTargetPathname,
  subscribeLeavePrompt,
} from '../../application/routing/leave-guard';

// DECISION: the dialog (Base UI Dialog, focus manager, floating-ui, ~50 KB) is its own chunk,
// since public pages never raise a prompt. On an /app screen it is fetched when the browser is
// idle, BEFORE any prompt: a prompt waiting for a fetch would block navigation with no dialog
// when the phone is offline. The router seam stays eager; once mounted the dialog stays.
const loadPromptDialog = () =>
  import('./LeaveGuardPromptDialog.organism').then(
    m => m.LeaveGuardPromptDialogOrganism
  );
const LeaveGuardPromptDialog = dynamic(loadPromptDialog, { ssr: false });

const APP_ROUTE_PREFIX = '/app';

function preloadWhenIdle(): () => void {
  const preload = () => {
    void loadPromptDialog();
  };
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(preload, { timeout: 4000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(preload, 1500);
  return () => window.clearTimeout(handle);
}

type NextRouterInstance = NonNullable<(typeof Router)['router']>;

function installRouterSeam(router: NextRouterInstance): () => void {
  const originalPush = router.push.bind(router);
  const originalReplace = router.replace.bind(router);

  const trackScroll = <T,>(
    target: string,
    scroll: boolean | undefined,
    navigate: () => Promise<T>
  ): Promise<T> => {
    const clear = noteScrollOption(target, scroll);
    return navigate().finally(clear);
  };

  router.push = (url, as, options) => {
    const target = resolveTargetPathname(as ?? url, window.location.pathname);
    if (
      !requestLeave(
        target,
        () =>
          void trackScroll(target, options?.scroll, () =>
            originalPush(url, as, options)
          )
      )
    ) {
      return Promise.resolve(false);
    }
    return trackScroll(target, options?.scroll, () =>
      originalPush(url, as, options)
    );
  };
  router.replace = (url, as, options) => {
    const target = resolveTargetPathname(as ?? url, window.location.pathname);
    if (
      !requestLeave(
        target,
        () =>
          void trackScroll(target, options?.scroll, () =>
            originalReplace(url, as, options)
          )
      )
    ) {
      return Promise.resolve(false);
    }
    return trackScroll(target, options?.scroll, () =>
      originalReplace(url, as, options)
    );
  };

  return () => {
    router.push = originalPush;
    router.replace = originalReplace;
  };
}

export function LeaveGuardDialogComposition() {
  const { pathname } = useRouter();
  const isAppRoute =
    pathname === APP_ROUTE_PREFIX ||
    pathname.startsWith(`${APP_ROUTE_PREFIX}/`);
  const prompt = useSyncExternalStore(
    subscribeLeavePrompt,
    getLeavePrompt,
    () => null
  );
  const [hasPrompted, setHasPrompted] = useState(false);
  if (prompt !== null && !hasPrompted) {
    setHasPrompted(true);
  }

  useEffect(() => {
    const router = Router.router;
    if (router === null) {
      return;
    }
    return installRouterSeam(router);
  }, []);

  useEffect(() => {
    if (!isAppRoute) {
      return;
    }
    return preloadWhenIdle();
  }, [isAppRoute]);

  return hasPrompted ? <LeaveGuardPromptDialog prompt={prompt} /> : null;
}
