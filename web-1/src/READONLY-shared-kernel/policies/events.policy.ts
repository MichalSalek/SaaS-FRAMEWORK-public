import { EVENTS } from '../domain/commands-and-queries/cqrs.config';
import type {
  EVENT_INFO_TYPE,
  GROUP_KEY,
} from '../domain/commands-and-queries/cqrs.types';

// Cached Set for O(1) lookup — built once at module load
const INFO_EVENTS_SET: ReadonlySet<string> = new Set(
  Object.keys(EVENTS.INFO)
    .map(groupKey => EVENTS.INFO[groupKey as GROUP_KEY])
    .flat(Infinity) as string[]
);

export type EVENTS_POLICY_TYPE = {
  utils: {
    IS_INFO_EVENT: (
      event: EVENT_INFO_TYPE | string | undefined | null
    ) => boolean;
  };
};
export const EVENTS_POLICY: EVENTS_POLICY_TYPE = {
  utils: {
    IS_INFO_EVENT: event => {
      return INFO_EVENTS_SET.has(event as string);
    },
  } as const,
} as const;
