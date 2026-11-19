// UI/features/account/UserActivityPage.events-map.test.ts
// Ratchet parity: kernel USER_FACING_ACTIVITY_EVENTS (server-side whitelist of
// the event-log/get-all endpoint) <-> frontend EVENT_MAP (event -> VisualSpec).
// Direction 1: every whitelisted event HAS an EVENT_MAP row (else it passes the
//   backend filter and renders as FALLBACK_SPEC spam).
// Direction 2: every EVENT_MAP row of the LOGIN/ACCOUNT buckets IS on the
//   whitelist (else the backend filters it out and the row is dead).

import { describe, expect, it } from 'vitest';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import {
  allowedEventLogTypeSets,
  USER_FACING_ACTIVITY_EVENTS,
} from '@kernel/domain/event-log/event_log.config';
import type { EVENTS_ALL_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import { EVENT_MAP } from './UserActivityPage.events-map';

describe('USER_FACING_ACTIVITY_EVENTS ↔ EVENT_MAP parity', () => {
  it('every whitelisted user-facing event has an EVENT_MAP row', () => {
    const missing = USER_FACING_ACTIVITY_EVENTS.filter(
      event => EVENT_MAP[event] === undefined
    );
    expect(missing).toEqual([]);
  });

  it('every EVENT_MAP row from the LOGIN/ACCOUNT buckets is whitelisted', () => {
    const whitelist: ReadonlySet<EVENTS_ALL_TYPE> = new Set(
      USER_FACING_ACTIVITY_EVENTS
    );
    const fetchedBuckets = [
      allowedEventLogTypeSets[EventLogTypeValue.LOGIN],
      allowedEventLogTypeSets[EventLogTypeValue.ACCOUNT],
    ];
    const mappedEvents = Object.keys(EVENT_MAP) as EVENTS_ALL_TYPE[];
    const filteredOut = mappedEvents.filter(
      event =>
        fetchedBuckets.some(bucket => bucket.has(event)) &&
        !whitelist.has(event)
    );
    expect(filteredOut).toEqual([]);
  });

  it('whitelist has no duplicates', () => {
    expect(new Set(USER_FACING_ACTIVITY_EVENTS).size).toBe(
      USER_FACING_ACTIVITY_EVENTS.length
    );
  });
});
