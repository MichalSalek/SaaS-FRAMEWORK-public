import { useEffect, useState } from 'react';
import {
  noteScreen,
  type ScreenArrival,
} from '../../application/routing/screen-arrival';

/**
 * Reports this screen to the navigation trail and returns how it was reached
 * (DECISION in application/routing/screen-arrival.ts). Null on the server and
 * on the first client render, so both render the same thing.
 */
export function useScreenArrival(
  pathname: string,
  isTabRoot: boolean
): ScreenArrival | null {
  const [arrival, setArrival] = useState<ScreenArrival | null>(null);
  useEffect(() => {
    setArrival(noteScreen(pathname, isTabRoot));
  }, [pathname, isTabRoot]);
  return arrival;
}
