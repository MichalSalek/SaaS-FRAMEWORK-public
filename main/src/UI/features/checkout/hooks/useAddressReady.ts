import { useCallback, useRef, useState } from 'react';

/** The ref closes the gap before React commits the disabled payment button. */
export function useAddressReady(initial: boolean) {
  const [ready, setReadyState] = useState(initial);
  const readyRef = useRef(initial);
  const setReady = useCallback((value: boolean) => {
    readyRef.current = value;
    setReadyState(value);
  }, []);
  return [ready, setReady, readyRef] as const;
}
