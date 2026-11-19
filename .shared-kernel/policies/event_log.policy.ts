import type { EVENT_INFO_TYPE } from '../domain/commands-and-queries/cqrs.types';
import {
  allowedEventLogTypeSets,
  allowedEventLogTypesValuesSet,
} from '../domain/event-log/event_log.config';
import type { EventLogType } from '../models/db_models.generated.dto';
import { EventLogTypeValueEnum } from '../models/db_models.manual.dto';

export type EVENT_LOG_POLICY_TYPE = {
  utils: {
    GET_PERMISSION_APPROVAL_TO_PUSH_EVENT_LOG: (
      eventLog: EVENT_INFO_TYPE | unknown
    ) => boolean;
    GET_EVENT_LOG_TYPE_FOR_EVENT_LOG: (
      eventLog: EVENT_INFO_TYPE | unknown
    ) => EventLogType | undefined;
  };
};

export const EVENT_LOG_POLICY: EVENT_LOG_POLICY_TYPE = {
  utils: {
    GET_PERMISSION_APPROVAL_TO_PUSH_EVENT_LOG: eventLog =>
      // EventLog is included in allowedEventLogTypes permission array.
      Boolean(allowedEventLogTypesValuesSet.has(eventLog as EVENT_INFO_TYPE)),

    GET_EVENT_LOG_TYPE_FOR_EVENT_LOG: eventLog => {
      // Get event category of a given event log.
      return EventLogTypeValueEnum.find((eventLogType: EventLogType) =>
        allowedEventLogTypeSets[eventLogType].has(eventLog as EVENT_INFO_TYPE)
      );
    },
  } as const,
} as const;
