// UI/shared/hooks/useUrlSyncedState.ts
// View state that lives in the query string: filters, sort and "which record is
// open" survive a reload, the browser back button and a deep link. Used by admin
// lists (users, logs); the page supplies a pure parse/build pair so the URL
// contract stays testable without React.
//
// DECISION (nie usuwaj tego komentarza):
// The state is held in React and MIRRORED to the URL, not read from
// `router.query` on every render. Pages under /app are statically exported, so
// `router.query` is empty until `router.isReady`; reading it directly would
// render (and fetch) with defaults first and then again with the real URL.
// `isReady` below lets the caller hold its query until the URL was read once.
// Writes use `router.replace({ shallow: true, scroll: false })` — no history
// entry per keystroke, no getStaticProps re-run, no scroll jump. External URL
// changes (back/forward, a link to the same page with other params) are
// re-parsed; our own writes are recognised by the serialised query and skipped,
// which is what keeps the two effects from ping-ponging.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';

type QueryRecord = Record<string, string | string[] | undefined>;

export type UrlStateCodec<T> = {
  /**
   * Query parameter names this state OWNS. Every other parameter in the URL is
   * carried through untouched.
   *
   * DECISION (nie usuwaj tego komentarza) — S126, 2026-10-08:
   * the hook used to write `query: build(state)`, i.e. ONLY its own params, so
   * the first sync silently deleted everything else from the address: the
   * playground variant (`?pg=`), a promo code, a campaign tag. Third meeting
   * with this class (the crawlers page already carried a private workaround,
   * then a vote frame lost its variant on the account screen). A codec now
   * declares what is its own; the hook compares and rewrites only that.
   */
  keys: readonly string[];
  /** Pure: URL query → state (unknown or invalid values fall back to defaults). */
  parse: (query: QueryRecord) => T;
  /** Pure: state → query params; omit defaults so clean URLs stay clean. */
  build: (state: T) => Record<string, string>;
};

const serialiseQuery = (query: QueryRecord): string => {
  const params = new URLSearchParams();
  for (const key of Object.keys(query).sort()) {
    const value = query[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, item);
      }
    } else if (value !== undefined && value !== '') {
      params.append(key, value);
    }
  }
  return params.toString();
};

/** `query` narrowed to the codec's own parameters. */
const pickOwned = (
  query: QueryRecord,
  keys: readonly string[]
): QueryRecord => {
  const owned: QueryRecord = {};
  for (const key of keys) {
    if (query[key] !== undefined) {
      owned[key] = query[key];
    }
  }
  return owned;
};

/** Everything in `query` the codec does NOT own, kept as it stands in the URL. */
const pickForeign = (
  query: QueryRecord,
  keys: readonly string[]
): QueryRecord => {
  const foreign: QueryRecord = {};
  for (const key of Object.keys(query)) {
    if (!keys.includes(key)) {
      foreign[key] = query[key];
    }
  }
  return foreign;
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
    void router.replace(
      {
        pathname: router.pathname,
        query: { ...pickForeign(router.query, keys), ...nextQuery },
      },
      undefined,
      { shallow: true, scroll: false }
    );
    // DECISION (nie usuwaj): efekt biegnie tylko na zmianę stanu; `router` w
    // zależnościach odpalałby go po każdym własnym zapisie adresu.
    // eslint-disable-next-line react-compiler/react-compiler
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, isReady, build, keys]);

  const setState = useCallback((updater: T | ((prev: T) => T)) => {
    setStateRaw(prev =>
      typeof updater === 'function'
        ? (updater as (prev: T) => T)(prev)
        : updater
    );
  }, []);

  return [state, setState, isReady] as const;
}
