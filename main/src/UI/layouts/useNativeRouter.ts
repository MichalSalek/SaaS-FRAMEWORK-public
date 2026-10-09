import { useMemo } from 'react';
import { useRouter } from 'next/router';
import { runNavigationIntent } from '../../application/routing/navigation.possibilities.api';

/**
 * Unified, imperative navigation channel for the whole app (NVT).
 *
 * Returns `{ push, replace, back }`. Each method drives `next/router` through
 * `runNavigationIntent`, i.e. the navigation transition FSM
 * (`navigation.store.ts` + `NavigationTransitionController`):
 *
 *   • `push` / `replace` → direction 'forward'
 *   • `back`             → direction 'back' (reversed keyframes)
 *
 * Hook-driven navigations get the exit-first-then-navigate grade (O19): the
 * old content's exit animation is guaranteed to finish before the router
 * swaps the page. Policy (slide/fade/instant) resolves from the target zone
 * (navigation-transition.policy) unless an explicit intent overrides it.
 *
 * No View Transitions API, no flushSync, no direct DOM writes here — the
 * controller owns the DOM channel (audit:no-view-transition-api).
 */

export interface NativeRouter {
  push: (to: string) => void;
  replace: (to: string) => void;
  back: () => void;
}

export function useNativeRouter(): NativeRouter {
  const router = useRouter();

  return useMemo<NativeRouter>(
    () => ({
      push: to => {
        void runNavigationIntent(
          {
            direction: 'forward',
            targetPathname: to,
            reason: 'native-router-push',
          },
          () => router.push(to)
        );
      },
      replace: to => {
        void runNavigationIntent(
          {
            direction: 'forward',
            targetPathname: to,
            reason: 'native-router-replace',
          },
          () => router.replace(to)
        );
      },
      back: () => {
        void runNavigationIntent(
          { direction: 'back', reason: 'native-router-back' },
          () => {
            router.back();
          }
        );
      },
    }),
    [router]
  );
}
