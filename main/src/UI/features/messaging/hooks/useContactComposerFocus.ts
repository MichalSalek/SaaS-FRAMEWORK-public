import { useEffect, useRef, type RefObject } from 'react';
import { useRouter } from 'next/router';
import { useNavigationStore } from '../../../../application/stores/navigation.store';

/** A profile contact opens focus only after the navigation controller settles. */
export function useContactComposerFocus(
  pairId: string,
  canSend: boolean,
  input: RefObject<HTMLTextAreaElement | null>
) {
  const router = useRouter();
  const phase = useNavigationStore(state => state.phase);
  const focusedPair = useRef<string | null>(null);
  useEffect(() => {
    if (
      phase !== 'idle' ||
      router.query.focus !== '1' ||
      !canSend ||
      !pairId ||
      focusedPair.current === pairId ||
      !input.current
    ) {
      return;
    }
    focusedPair.current = pairId;
    input.current.focus();
    const { focus: _focus, ...query } = router.query;
    void router.replace({ pathname: router.pathname, query }, undefined, {
      shallow: true,
    });
  }, [phase, router, canSend, pairId, input]);
}
