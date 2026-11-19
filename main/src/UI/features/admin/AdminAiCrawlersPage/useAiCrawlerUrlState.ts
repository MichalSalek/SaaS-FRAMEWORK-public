import { useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/router';
import { useUrlSyncedState } from '../../../shared/hooks/useUrlSyncedState';
import type { AiCrawlerListRequest } from '../hooks/useAiCrawlerList';
import {
  FILTER_QUERY_KEYS,
  buildUrlQuery,
  parseUrlParams,
} from './AdminAiCrawlersPage.url.helpers';

export function useAiCrawlerUrlState() {
  const router = useRouter();
  const queryRef = useRef(router.query);
  queryRef.current = router.query;

  // Stable identity keeps a landed own write from triggering another URL
  // write, while the ref preserves unrelated parameters from the latest URL.
  const build = useCallback(
    (state: AiCrawlerListRequest) => buildUrlQuery(state, queryRef.current),
    []
  );
  const codec = useMemo(
    () => ({ keys: FILTER_QUERY_KEYS, parse: parseUrlParams, build }),
    [build]
  );
  return useUrlSyncedState(codec);
}
