import { useCallback, useEffect, useRef } from 'react';
import { useRouter, type NextRouter } from 'next/router';
import { NATIVE_BACK_EVENT } from '../../../application/platform/native-back';
import {
  beginPlanDecisionPush,
  finishPlanDecisionPush,
  hasPlanDecision,
  hasPlanDecisionOwner,
  hasPendingPlanDecisionPush,
  isPlanDecisionRouterSettled,
  planDecisionUrl,
  registerPlanDecisionOwner,
  reversePlanDecisionPush,
} from '../../../application/routing/plan-decision-navigation';

/** Keep the mounted payment tree while browser and native Back dismiss one step. */
export function usePlanDecisionNavigation({
  onClose,
  dismissLocked,
}: {
  onClose: () => void;
  dismissLocked: boolean;
}): () => void {
  const router = useRouter();
  const latest = useRef({ router, onClose, dismissLocked });
  const pushed = useRef(false);
  const closing = useRef(false);
  useEffect(() => {
    latest.current = { router, onClose, dismissLocked };
  }, [router, onClose, dismissLocked]);

  const close = useCallback(() => {
    const current = latest.current;
    if (current.dismissLocked || closing.current) {
      return;
    }
    closing.current = true;
    const livePath =
      window.location.pathname + window.location.search + window.location.hash;
    if (pushed.current && hasPlanDecision(livePath)) {
      current.router.back();
    } else if (hasPlanDecision(livePath)) {
      void current.router
        .replace(planDecisionUrl(livePath, false), undefined, {
          shallow: true,
          scroll: false,
        })
        .then(current.onClose, current.onClose);
    } else {
      current.onClose();
    }
  }, []);

  const ready = router.isReady;
  const asPath = router.asPath;
  useEffect(() => {
    if (!ready) {
      return;
    }
    let disposed = false;
    const registration = registerPlanDecisionOwner({
      isLocked: () => latest.current.dismissLocked,
      onHistoryClose: () => {
        closing.current = true;
        latest.current.onClose();
      },
      onHistoryCloseBlocked: () => {
        closing.current = false;
      },
    });
    // StrictMode may replay setup before a router push settles. Only the live
    // effect may create the presentation entry, and no payment state is remounted.
    queueMicrotask(() => {
      if (disposed || closing.current) {
        return;
      }
      const currentRouter = latest.current.router;
      const livePath =
        window.location.pathname +
        window.location.search +
        window.location.hash;
      if (!isPlanDecisionRouterSettled(currentRouter.asPath, livePath)) {
        return;
      }
      if (hasPlanDecision(livePath)) {
        registration.snapshot();
        return;
      }
      pushed.current = true;
      const target = planDecisionUrl(livePath, true);
      const pushToken = beginPlanDecisionPush();
      void currentRouter
        .push(target, undefined, {
          shallow: true,
          scroll: false,
        })
        .then(completed => {
          if (!disposed && completed) {
            registration.snapshot();
            finishPlanDecisionPush(pushToken);
          } else if (
            disposed &&
            completed &&
            !hasPlanDecisionOwner() &&
            new URL(target, window.location.href).pathname ===
              window.location.pathname &&
            hasPlanDecision(window.location.href)
          ) {
            // A late push must not undo a departure or leave a duplicate grid
            // entry after this decision has already unmounted.
            reversePlanDecisionPush(pushToken);
            currentRouter.back();
          } else {
            finishPlanDecisionPush(pushToken);
          }
        })
        .catch(() => {
          finishPlanDecisionPush(pushToken);
          pushed.current = false;
        });
    });
    const nativeBack = (event: Event) => {
      event.preventDefault();
      close();
    };
    window.addEventListener(NATIVE_BACK_EVENT, nativeBack);
    return () => {
      disposed = true;
      registration.release();
      window.removeEventListener(NATIVE_BACK_EVENT, nativeBack);
    };
  }, [ready, asPath, close]);
  return close;
}

/** Cold load / forward into an orphan flag never resurrects a payment attempt. */
export function usePlanDecisionCleanup(router: NextRouter): void {
  const { isReady, asPath, replace } = router;
  useEffect(() => {
    if (!isReady || !hasPlanDecision(asPath)) {
      return;
    }
    let disposed = false;
    queueMicrotask(() => {
      if (disposed || hasPlanDecisionOwner() || hasPendingPlanDecisionPush()) {
        return;
      }
      const livePath =
        window.location.pathname +
        window.location.search +
        window.location.hash;
      if (!hasPlanDecision(livePath)) {
        return;
      }
      void replace(planDecisionUrl(livePath, false), undefined, {
        shallow: true,
        scroll: false,
      }).catch(() => undefined);
    });
    return () => {
      disposed = true;
    };
  }, [isReady, asPath, replace]);
}
