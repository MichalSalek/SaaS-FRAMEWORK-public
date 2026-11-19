// UI/shared/hooks/useUrlStateWriter.ts
// The state → URL half of useUrlSyncedState.

import { useEffect, type RefObject } from 'react';
import type { NextRouter } from 'next/router';
import { pickForeign, pickOwned, serialiseQuery } from './urlSyncedState.query';

type UrlStateWriterInput<T> = {
  router: NextRouter;
  state: T;
  isReady: boolean;
  build: (state: T) => Record<string, string>;
  keys: readonly string[];
  pendingWritesRef: RefObject<string[]>;
  syncedUrlRef: RefObject<string | null>;
};

/** Mirrors `state` into the query string (only after the URL was read, so defaults never clobber it). */
export function useUrlStateWriter<T>({
  router,
  state,
  isReady,
  build,
  keys,
  pendingWritesRef,
  syncedUrlRef,
}: UrlStateWriterInput<T>): void {
  // DECISION: the effect below leaves `router` (and the refs) out of its dependencies on purpose:
  // with `router` in them it would re-fire after every own URL write. This file is the one place
  // `react-hooks/exhaustive-deps` is off for it (main/eslint.config.mjs), and 'use no memo' keeps
  // the React Compiler from compiling around the omission.
  'use no memo';
  useEffect(() => {
    if (!isReady) {
      return;
    }
    const nextQuery = pickOwned(build(state), keys);
    const next = serialiseQuery(nextQuery);
    // With writes in flight the router's query is not the final URL yet, so an
    // equal value is not proof there is nothing to write.
    if (
      pendingWritesRef.current.length === 0 &&
      next === serialiseQuery(pickOwned(router.query, keys))
    ) {
      syncedUrlRef.current = next;
      return;
    }
    pendingWritesRef.current.push(next);
    const hashIndex = router.asPath.indexOf('#');
    void router.replace(
      {
        pathname: router.pathname,
        query: { ...pickForeign(router.query, keys), ...nextQuery },
        // Query normalization does not own the fragment used by a deep link.
        ...(hashIndex >= 0 && { hash: router.asPath.slice(hashIndex) }),
      },
      undefined,
      { shallow: true, scroll: false }
    );
    // Runs on state changes only; `router` in deps would re-fire it after every
    // own URL write.
  }, [state, isReady, build, keys]);
}
