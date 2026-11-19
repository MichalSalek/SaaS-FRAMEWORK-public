import { useState, useCallback, useRef, useEffect } from 'react';

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
