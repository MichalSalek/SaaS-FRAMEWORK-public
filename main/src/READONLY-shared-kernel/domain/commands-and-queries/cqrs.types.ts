import type { EVENTS } from './cqrs.config';

// DECISION: EVENTS_GROUPS is the intersection of keys across COMMANDS, QUERIES and INFO. CONFIRMATIONS
// is flat (one synthetic LINK group) and excluded on purpose, otherwise the intersection collapses to
// `never`; its events go through EVENT_CONFIRMATIONS_TYPE.
type NESTED_EVENTS_TYPES = 'COMMANDS' | 'QUERIES' | 'INFO';

type EVENTS_GROUPS = keyof (typeof EVENTS)[NESTED_EVENTS_TYPES];

export type GROUP_KEY = keyof typeof EVENTS.COMMANDS &
  keyof typeof EVENTS.QUERIES;

// GROUPED
//
export type EVENT_INFO_TYPE = (typeof EVENTS)['INFO'][EVENTS_GROUPS][number];

export type EVENT_COMMANDS_TYPE =
  (typeof EVENTS)['COMMANDS'][EVENTS_GROUPS][number];

export type EVENT_QUERIES_TYPE =
  (typeof EVENTS)['QUERIES'][EVENTS_GROUPS][number];

// DECISION: CONFIRMATIONS are GET-as-command events from emailed links (public, token-verified),
// distinct from COMMANDS (POST) and QUERIES (GET). EVENT_CONFIRMATIONS_TYPE is unioned into
// EVENT_COMMANDS_AND_QUERIES_TYPE so middleware, permissions and the ENDPOINTS map accept it
// uniformly; the alias name is kept and now means "all handler events".
export type EVENT_CONFIRMATIONS_TYPE =
  (typeof EVENTS)['CONFIRMATIONS'][keyof (typeof EVENTS)['CONFIRMATIONS']][number];

// COMMANDS AND QUERIES (and CONFIRMATIONS — see DECISION above)
//
export type EVENT_COMMANDS_AND_QUERIES_TYPE =
  EVENT_COMMANDS_TYPE | EVENT_QUERIES_TYPE | EVENT_CONFIRMATIONS_TYPE;

// ALL EVENTS
//
export type EVENTS_ALL_TYPE =
  | (typeof EVENTS)[NESTED_EVENTS_TYPES][EVENTS_GROUPS][number]
  | EVENT_CONFIRMATIONS_TYPE;
