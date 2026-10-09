import { useState, useCallback, useRef, useEffect } from 'react';
import {
  deleteSessionStorage,
  getSessionStorage,
  setSessionStorage,
} from '../../../../application/client-device-storage/session-storage-adapter/sessionStorage.adapter';
import { STORAGE_KEYS } from '../../../../application/client-device-storage/storage-keys.config';

const SCROLL_POSITION_KEY = STORAGE_KEYS.EXPLORE_SCROLL_POSITION;

// Scroll owner of the app shell is the inner #main-content container
// (<main> in AppLayout), NOT window (NVT O7). Save/restore targets it;
// window is kept only as a safety fallback.
export function useScrollRestoration() {
  useEffect(() => {
    const savedPosition = getSessionStorage(SCROLL_POSITION_KEY);
    if (savedPosition) {
      const main = document.getElementById('main-content');
      if (main) {
        main.scrollTop = Number(savedPosition);
      } else {
        // behavior:'auto' — override globalnego scroll-behavior:smooth: przywrócenie
        // ZAPISANEJ pozycji ma być natychmiastowe (user wraca dokładnie tam, gdzie
        // był; smooth-scroll przez pół strony przy powrocie = złe UX, nie „skok").
        window.scrollTo({ top: Number(savedPosition), behavior: 'auto' });
      }
      deleteSessionStorage(SCROLL_POSITION_KEY);
    }
  }, []);
}

export function saveScrollPosition() {
  const main = document.getElementById('main-content');
  const y = main ? main.scrollTop : window.scrollY;
  setSessionStorage(SCROLL_POSITION_KEY, String(y));
}

export function useDebouncedSearch(
  setSearchQuery: (q: string | undefined) => void
) {
  const [searchInput, setSearchInput] = useState('');
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setSearchInput(value);
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      searchTimeoutRef.current = setTimeout(() => {
        setSearchQuery(value.trim() || undefined);
      }, 300);
    },
    [setSearchQuery]
  );

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  // „Wyczyść" must also cancel a debounce still in flight: otherwise a phrase
  // typed <300 ms before clearing was applied AFTER the clear, filtering the
  // feed by text that is no longer in the (now empty) input.
  const resetSearch = useCallback(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = undefined;
    }
    setSearchInput('');
  }, []);

  return { searchInput, resetSearch, handleSearchChange };
}
