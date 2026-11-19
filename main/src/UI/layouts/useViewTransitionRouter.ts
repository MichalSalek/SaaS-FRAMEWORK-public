import { useCallback } from 'react';
import { useNativeRouter } from './useNativeRouter';

/**
 * Backwards-compatible navigation helper, a thin wrapper over the unified
 * imperative channel `useNativeRouter`. Kept so the existing `navigate()` call
 * sites (`navigate('/somewhere')` / `navigate('back')`) work unchanged.
 *
 * NAME IS HISTORICAL (superseded by NVT): transitions no longer use the View
 * Transitions API — navigation flows through the FSM in `navigation.store.ts`.
 * Rename to `useNavigationRouter` is a post-MVP cleanup, not an NVT gate.
 */
type ViewTransitionTarget = string | 'back';

export function useViewTransitionRouter() {
  const nav = useNativeRouter();

  return useCallback(
    (to: ViewTransitionTarget) => {
      if (to === 'back') {
        nav.back();
      } else {
        nav.push(to);
      }
    },
    [nav]
  );
}
