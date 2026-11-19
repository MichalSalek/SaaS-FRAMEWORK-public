import { useRef, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { ProgressAtom } from './Progress/Progress.atom';
import { ButtonAtom } from './Button/Button.atom';

interface InfiniteScrollTriggerProps {
  hasNextPage: boolean | undefined;
  isFetchingNextPage: boolean;
  onFetchNextPage: (() => void) | (() => Promise<unknown>);
  rootMargin?: string;
  /** Callers that render their own „loading more" skeleton pass false — the
   *  sentinel keeps observing, only the inline spinner is dropped. */
  showSpinner?: boolean;
  /** TanStack `isFetchNextPageError`. After a failed page `hasNextPage` stays
   *  true, so without this flag the list looks finished (the observer only
   *  fires on a NEW intersection and the sentinel never left the viewport).
   *  When true the trigger stops auto-fetching and renders an inline message
   *  with a manual retry; already loaded items are untouched. */
  isFetchNextPageError?: boolean;
}

export function InfiniteScrollTriggerComposition({
  hasNextPage,
  isFetchingNextPage,
  onFetchNextPage,
  rootMargin = '300px',
  showSpinner = true,
  isFetchNextPageError = false,
}: InfiniteScrollTriggerProps) {
  const t = useTranslations('components.infiniteScroll');
  const tButtons = useTranslations('buttons');
  const sentinelRef = useRef<HTMLDivElement>(null);

  const stableFetchNext = useCallback(() => {
    void onFetchNextPage();
  }, [onFetchNextPage]);

  // Only armed while a fetch may start. Re-creating the observer when a fetch
  // settles is deliberate: `observe()` reports the CURRENT intersection once,
  // so a sentinel still on screen after a short page (or after a successful
  // manual retry) loads the next page. An observer kept across fetches fires
  // only on a NEW intersection, and a sentinel that never left the viewport
  // left the list stalled until the user scrolled.
  const canAutoFetch =
    hasNextPage === true && !isFetchingNextPage && !isFetchNextPageError;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !canAutoFetch) {
      return;
    }

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting) {
          observer.disconnect();
          stableFetchNext();
        }
      },
      { rootMargin }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canAutoFetch, stableFetchNext, rootMargin]);

  const showError =
    isFetchNextPageError && hasNextPage === true && !isFetchingNextPage;

  return (
    <div
      ref={sentinelRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--space-8)',
        padding:
          showError || (showSpinner && isFetchingNextPage) ? '16px 0' : 0,
      }}>
      {showSpinner && isFetchingNextPage && (
        <ProgressAtom variant='spinner' size='sm' />
      )}
      {showError && (
        <>
          <span role='alert' style={{ color: 'var(--color-text-secondary)' }}>
            {t('loadMoreError')}
          </span>
          <ButtonAtom variant='outlined' size='sm' onClick={stableFetchNext}>
            {tButtons('retry')}
          </ButtonAtom>
        </>
      )}
    </div>
  );
}
