import { contractEndpoint } from '../../application/http/io';
import { EVENT_LOG_CONTRACTS } from '@kernel/domain/event-log/event-log.contracts';

export const getEventLogs_IO = contractEndpoint(
  EVENT_LOG_CONTRACTS.EVENT_LOG_GET_ALL
);
