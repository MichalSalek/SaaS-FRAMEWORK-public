import type { EVENTS } from './cqrs.config';

// DECISION (nie usuwaj tego komentarza):
// EVENTS_GROUPS = intersection of keys across COMMANDS, QUERIES, INFO (the "nested"
// sections sharing the same domain groups: ADMIN, USER, GALLERY, ...). CONFIRMATIONS
// is FLAT (single synthetic LINK group) and intentionally excluded from this
// intersection so adding it doesn't collapse EVENTS_GROUPS to `never`. Confirmation
// events are extracted via a dedicated EVENT_CONFIRMATIONS_TYPE indexing.
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

// DECISION (nie usuwaj tego komentarza):
// CONFIRMATIONS = GET-as-Command events from emailed confirmation links (public access,
// token-verified). Distinct from COMMANDS (POST mutations) and QUERIES (GET reads).
// EVENT_CONFIRMATIONS_TYPE is unioned into EVENT_COMMANDS_AND_QUERIES_TYPE so
// middleware/handler signatures, permissions, ENDPOINTS map and DB permission entity
// accept CONFIRMATIONS uniformly. Name kept for backward compatibility — the alias
// now means "all handler events" (COMMANDS + QUERIES + CONFIRMATIONS).
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
