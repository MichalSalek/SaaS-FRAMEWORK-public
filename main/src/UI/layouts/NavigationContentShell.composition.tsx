// Content shell for NVT page transitions. Rendered by every layout INSIDE its
// main/content slot, wrapping only the routed page content — fixed chrome
// (AppBar, tabbar, drawer, sidebars) stays outside and never animates.
//
// The shell itself is a passive div; all motion comes from CSS in
// `navigation-transition.module.css`, keyed off `html[data-nav-*]` attributes
// written by `NavigationTransitionController`. The shell's job is telemetry
// back into the FSM:
//
//   - `animationend` on itself → markExitDone / markEnterDone,
//   - unmount while the FSM is 'exiting' → markExitDone (O19 best-effort
//     grade: Next commits the new page before routeChangeComplete, killing
//     the old shell mid-exit — the unmount IS the exit boundary then),
//   - a shell mounted mid-transition marks itself `data-nav-incoming` so the
//     exit keyframes never play on the NEW page's content; the marker is
//     dropped when the FSM settles or a newer transition begins.
//
// DECISION (nie usuwaj tego komentarza):
// Same-Component navigations ([slug]→[slug], np. blog related-posts) NIE
// remountują shella — commit podmienia dzieci w locie, więc końcówka exit
// keyframes gra już na nowej treści. Świadomie zaakceptowane: jedyna taka
// powierzchnia to blog (BLOG_ENABLED=false, parked), a fix (key po asPath =
// wymuszony remount treści) kosztowałby remount każdej strony przy zmianie
// parametru. Wrócić do tematu przy odpaleniu bloga.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigationStore } from '../../application/stores/navigation.store';
import styles from './navigation-transition.module.css';

interface NavigationContentShellProps {
  children: ReactNode;
}

export function NavigationContentShellComposition({
  children,
}: NavigationContentShellProps) {
  // Mounted mid-transition ⇒ this is the INCOMING page's content. SSR-safe:
  // on the server (and during hydration of a fresh load) the FSM is idle.
  const [isIncoming, setIsIncoming] = useState(
    () =>
      typeof window !== 'undefined' &&
      useNavigationStore.getState().phase !== 'idle'
  );
  // Lazy initializer (not a bare useRef arg) — react-compiler forbids
  // referencing the store hook as a value during render outside a closure.
  const [mountTransitionId] = useState(() =>
    typeof window !== 'undefined'
      ? useNavigationStore.getState().transitionId
      : 0
  );
  const isIncomingRef = useRef(isIncoming);
  isIncomingRef.current = isIncoming;

  // Drop the incoming marker once the transition settles — OR once a NEWER
  // transition begins (adversarial A3: a tap during 'entering' makes THIS
  // shell the exiting content; a lingering incoming marker would block the
  // exit keyframes and stall the armed nav until the 600ms cap).
  useEffect(() => {
    if (!isIncoming) {
      return undefined;
    }
    const settled = (phase: string, transitionId: number): boolean =>
      phase === 'idle' || transitionId !== mountTransitionId;
    const initial = useNavigationStore.getState();
    if (settled(initial.phase, initial.transitionId)) {
      setIsIncoming(false);
      return undefined;
    }
    const unsubscribe = useNavigationStore.subscribe(state => {
      if (settled(state.phase, state.transitionId)) {
        setIsIncoming(false);
        unsubscribe();
      }
    });
    return unsubscribe;
  }, [isIncoming, mountTransitionId]);

  // Unmount-as-exitDone: the current shell being destroyed while the FSM is
  // exiting means Next already swapped the DOM — nothing left to animate.
  useEffect(() => {
    return () => {
      const state = useNavigationStore.getState();
      if (!isIncomingRef.current && state.phase === 'exiting') {
        state.markExitDone(state.transitionId);
      }
    };
  }, []);

  const handleAnimationEnd = (
    event: React.AnimationEvent<HTMLDivElement>
  ): void => {
    // Only the shell's own keyframes count — child animations bubble too.
    if (event.target !== event.currentTarget) {
      return;
    }
    const state = useNavigationStore.getState();
    if (state.phase === 'exiting' && !isIncomingRef.current) {
      state.markExitDone(state.transitionId);
      return;
    }
    if (state.phase === 'entering') {
      state.markEnterDone(state.transitionId);
    }
  };

  return (
    <div
      className={styles.shell}
      data-navigation-content-shell=''
      data-nav-incoming={isIncoming ? '' : undefined}
      onAnimationEnd={handleAnimationEnd}>
      {children}
    </div>
  );
}
