// Content shell for page transitions. Layouts render it inside the content slot;
// chrome stays outside and does not animate. Motion is CSS keyed off
// `html[data-nav-*]`. The shell reports animationend, and an unmount during exit,
// back to the controller (Next commits the new page before routeChangeComplete,
// so that unmount is the exit boundary). A shell mounted mid-transition marks
// itself incoming so exit keyframes do not play on the new page.
// DECISION: keyed by the resolved path (asPath without query or hash). Without
// the key, same-component navigations would finish the exit on the new content.
// Query and hash changes keep the path, so filter state does not remount.

import { useRouter } from 'next/router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigationStore } from '../../application/stores/navigation.store';
import styles from './navigation-transition.module.css';

interface NavigationContentShellProps {
  children: ReactNode;
}

export function NavigationContentShellComposition({
  children,
}: NavigationContentShellProps) {
  const { asPath } = useRouter();
  const resolvedPath = asPath.split(/[?#]/)[0];
  return (
    <NavigationContentShellInner key={resolvedPath}>
      {children}
    </NavigationContentShellInner>
  );
}

function NavigationContentShellInner({
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
