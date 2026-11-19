import { useInfiniteQuery } from '@tanstack/react-query';
import type { InfiniteData, QueryKey } from '@tanstack/react-query';
import { getEventLogs_IO } from '../../../../domain/event-log/eventLogIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { EventLogType } from '@kernel/models/db_models.generated.dto';
import type { EVENT_LOG_DTO_API_V1 } from '@kernel/models/event-log/event_log.dto';

/* --- Types --- */

type EventLogsResponse = EVENT_LOG_DTO_API_V1['EVENT_LOG_GET_ALL']['RESPONSE'];

/* --- Helper: flatten infinite pages to flat records array --- */

export function flattenActivityPages(
  data: InfiniteData<EventLogsResponse> | undefined
): EventLogsResponse['records'] {
  return data?.pages.flatMap(p => p.records) ?? [];
}

/* --- Hook --- */

export function useActivityLog(type: EventLogType) {
  return useInfiniteQuery<
    EventLogsResponse,
    Error,
    InfiniteData<EventLogsResponse>,
    QueryKey,
    string | undefined
  >({
    queryKey: queryKeys.eventLog.byType(type),
    queryFn: ({ pageParam, signal }) => {
      const cursor = pageParam;
      return getEventLogs_IO(
        cursor != null ? { type, cursor, take: 30 } : { type, take: 30 },
        { signal }
      );
    },
    getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined,
    staleTime: 60_000,
  });
}
