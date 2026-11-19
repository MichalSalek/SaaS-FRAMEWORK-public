// UI/shared/hooks/useUrlSyncedState.ts
// View state that lives in the query string: filters, sort and "which record is
// open" survive a reload, the browser back button and a deep link. Used by admin
// lists (users, logs); the page supplies a pure parse/build pair so the URL
// contract stays testable without React.
//
// DECISION: state is held in React and MIRRORED to the URL, not read from
// `router.query` per render: /app pages are static, so `router.query` is empty
// until `isReady` and a direct read would render and fetch with defaults first.
// Writes are shallow `replace` (no history entry per keystroke, no scroll
// jump). External URL changes are re-parsed; our own pending writes are
// recognised and skipped, which keeps the two effects from ping-ponging.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  pickOwned,
  serialiseQuery,
  type QueryRecord,
} from './urlSyncedState.query';
import { useUrlStateWriter } from './useUrlStateWriter';

export type UrlStateCodec<T> = {
  /**
   * Query parameter names this state OWNS. Every other parameter in the URL is
   * carried through untouched.
   *
   * DECISION: the hook compares and rewrites ONLY these keys. Writing just
   * `build(state)` silently deleted every other param on the first sync
   * (`?pg=`, a promo code, a campaign tag).
   */
  keys: readonly string[];
  /** Pure: URL query → state (unknown or invalid values fall back to defaults). */
  parse: (query: QueryRecord) => T;
  /** Pure: state → query params; omit defaults so clean URLs stay clean. */
  build: (state: T) => Record<string, string>;
};

export function useUrlSyncedState<T>(
  codec: UrlStateCodec<T>
): readonly [T, (updater: T | ((prev: T) => T)) => void, boolean] {
  const router = useRouter();
  const { parse, build, keys } = codec;
  const [state, setStateRaw] = useState<T>(() => parse({}));
  const [isReady, setIsReady] = useState(false);
  // URL the state currently agrees with (last parsed, or our own write landed).
  const syncedUrlRef = useRef<string | null>(null);
  // Our writes still in flight, oldest first. A single "last written" value was
  // not enough: `router.replace` is async, so while typing in a synced search
  // field the URL of keystroke N could land AFTER keystroke N+1 was written,
  // look foreign, get parsed back and wipe the newer input.
  const pendingWritesRef = useRef<string[]>([]);

  // URL → state: first time the router is ready, then on every URL change we
  // did not write ourselves.
  useEffect(() => {
    if (!router.isReady) {
      return;
    }
    const current = serialiseQuery(pickOwned(router.query, keys));
    if (isReady) {
      const pending = pendingWritesRef.current;
      const ownIndex = pending.indexOf(current);
      if (ownIndex !== -1) {
        // One of our writes landed; anything older was superseded by it.
        pending.splice(0, ownIndex + 1);
        syncedUrlRef.current = current;
        return;
      }
      if (current === syncedUrlRef.current) {
        return;
      }
    }
    pendingWritesRef.current = [];
    syncedUrlRef.current = current;
    setStateRaw(parse(router.query));
    setIsReady(true);
  }, [router.isReady, router.query, parse, keys, isReady]);

  // state → URL (only after the URL was read, so defaults never clobber it).
  useUrlStateWriter({
    router,
    state,
    isReady,
    build,
    keys,
    pendingWritesRef,
    syncedUrlRef,
  });

  const setState = useCallback((updater: T | ((prev: T) => T)) => {
    setStateRaw(prev =>
      typeof updater === 'function'
        ? (updater as (prev: T) => T)(prev)
        : updater
    );
  }, []);

  return [state, setState, isReady] as const;
}
