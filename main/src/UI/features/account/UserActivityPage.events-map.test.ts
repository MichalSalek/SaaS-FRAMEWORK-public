// UI/features/account/UserActivityPage.events-map.test.ts
// Ratchet parity: kernel USER_FACING_ACTIVITY_EVENTS (server-side whitelist
// endpointu event-log/get-all) ↔ frontend EVENT_MAP (event → VisualSpec).
// Kierunek 1: każdy whitelistowany event MA wiersz w EVENT_MAP (inaczej
//   przechodzi przez backendowy filtr i renderuje się jako FALLBACK_SPEC spam).
// Kierunek 2: każdy wiersz EVENT_MAP z bucketów LOGIN/ACCOUNT JEST na
//   whiteliście (inaczej backend go odfiltruje i wiersz jest martwy).

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
