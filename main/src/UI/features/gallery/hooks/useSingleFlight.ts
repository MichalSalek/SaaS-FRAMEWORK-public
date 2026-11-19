import { useRef } from 'react';

/**
 * Wraps an async action so a second call is ignored while the first is still
 * running. The latch is a ref, not state: a mutation's `isPending` flips a
 * microtask late, so a double tap inside that window would start the action
 * twice (for publishing: TWO gallery records). The wrapper is rebuilt every
 * render, so it always runs the latest `action` closure.
 */
export function useSingleFlight<TArgs extends unknown[]>(
  action: (...args: TArgs) => Promise<void>
): (...args: TArgs) => Promise<void> {
  const inFlightRef = useRef(false);
  return async (...args: TArgs) => {
    if (inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    try {
      await action(...args);
    } finally {
      inFlightRef.current = false;
    }
  };
}
