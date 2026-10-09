// Optimistic favorite hearts over explore-shaped records (`is_favorited` per
// record). Shared by Explore and Style detail: both read the same explore
// query, so the server flag is the truth and taps are local overrides on top.

import { useState, useRef, useEffect } from 'react';
import { useToggleFavorite } from '../../favorites/hooks/useToggleFavorite';
import { createTapSequence } from '../tapSequence';

interface FavoritablePage {
  records: Array<{ gallery_record_id: string; is_favorited: boolean }>;
}

export function useRecordFavorites(pages: FavoritablePage[] | undefined) {
  const favoriteMutation = useToggleFavorite();
  const [toggleOverrides, setToggleOverrides] = useState<Map<string, boolean>>(
    () => new Map()
  );
  const [tapSequence] = useState(createTapSequence);

  const favoritedIds = (() => {
    const set = new Set<string>();
    for (const page of pages ?? []) {
      for (const record of page.records) {
        const override = toggleOverrides.get(record.gallery_record_id);
        const isFav = override !== undefined ? override : record.is_favorited;
        if (isFav) {
          set.add(record.gallery_record_id);
        }
      }
    }
    return set;
  })();

  const favoritedIdsRef = useRef(favoritedIds);
  favoritedIdsRef.current = favoritedIds;

  // Reconcile optimistic overrides with server truth. useToggleFavorite
  // invalidates the explore gallery onSettled, so after the refetch lands
  // record.is_favorited becomes authoritative. Drop any override that now
  // agrees with the server value — bez tego override czyszczony był TYLKO
  // w onError, więc po udanym toggle wpis zostawał na zawsze i stale
  // nadpisanie maskowało kolejne stany serwera (np. odznaczenie z innego
  // widoku/sesji). Flicker-free: usuwamy override dopiero gdy serwer dogonił.
  useEffect(() => {
    setToggleOverrides(prev => {
      if (prev.size === 0) {
        return prev;
      }
      let next: Map<string, boolean> | null = null;
      for (const page of pages ?? []) {
        for (const record of page.records) {
          const override = prev.get(record.gallery_record_id);
          if (override !== undefined && override === record.is_favorited) {
            next ??= new Map(prev);
            next.delete(record.gallery_record_id);
          }
        }
      }
      return next ?? prev;
    });
  }, [pages]);

  const handleFavoriteToggle = (recordId: string) => {
    const wasFavorited = favoritedIdsRef.current.has(recordId);
    const seq = tapSequence.begin(recordId);
    setToggleOverrides(prev => new Map(prev).set(recordId, !wasFavorited));
    // mutateAsync + catch, not mutate(vars, { onError }): per-call callbacks
    // of `mutate` fire only for the LATEST call, so a failed toggle followed by
    // a tap on another heart kept its wrong override (the reconcile effect
    // never clears it: the server value never agrees with a failed toggle).
    void favoriteMutation
      .mutateAsync({ gallery_record_id: recordId, isFavorited: wasFavorited })
      .catch(() => {
        // A newer tap on this heart owns the override now; wiping it here
        // would drop that tap's optimistic state while its request is live.
        if (!tapSequence.isLatest(recordId, seq)) {
          return;
        }
        // useToggleFavorite carries meta.suppressGlobalError; the HTTP interceptor
        // (event-bus Stage 1) owns the error toast. This only drops the
        // optimistic override — a local push stacked a second toast.
        setToggleOverrides(prev => {
          const next = new Map(prev);
          next.delete(recordId);
          return next;
        });
      });
  };

  return { favoritedIds, handleFavoriteToggle };
}
