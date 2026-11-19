import { z } from 'zod';
import { defineContracts } from '../../application/contracts/contract.types';
import { QUERY_FIELD } from '../../application/contracts/query-fields';
import type { EventLog } from '../../models/db_models.generated.dto';

type ActivityRecord = Pick<
  EventLog,
  'event_log_id' | 'event' | 'event_type' | 'created_at'
>;

type EventLogPage = {
  records: ActivityRecord[];
  nextCursor: string | null;
};

const recordedAt = z.union([z.string(), z.date()]);

/**
 * The activity screen. A missing or unknown `type` stays a literal `{ type: 'Required' }`
 * from the handler, not a middleware token.
 */
export const EVENT_LOG_CONTRACTS = defineContracts({
  EVENT_LOG_GET_ALL: {
    summary:
      'Stronicowana aktywność zalogowanej osoby, filtrowana typem zdarzenia.',
    group: 'EVENT_LOG',
    kind: 'QUERY',
    path: 'event-log/get-all',
    method: 'GET',
    body: null,
    query: {
      type: QUERY_FIELD.requiredString(),
      cursor: QUERY_FIELD.string(),
      take: QUERY_FIELD.int(50),
    },
    response: z.object({
      records: z.array(
        z.object({
          event_log_id: z.string(),
          event: z.string(),
          event_type: z.string(),
          created_at: recordedAt,
        })
      ),
      nextCursor: z.string().nullable(),
    }) as z.ZodType<EventLogPage>,
    successEvents: ['SUCCESS'],
    auditEvents: [],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },
});

export type EventLogContracts = typeof EVENT_LOG_CONTRACTS;
