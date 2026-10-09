// co-located unit tests — characterise CURRENT behaviour of
// ClientSessionsPage.disambiguation (time-of-day disambiguation for unnamed sessions).
// formatTimeOfDay uses LOCAL time (by design — see source comments), so tests
// that assert HH:MM must either:
//   (a) use fake timers to pin a timezone-independent instant, OR
//   (b) accept that the exact digits depend on the test runner's TZ.
// We use approach (b) for formatTimeOfDay and verify shape/length;
// for buildUnnamedDayCollisionTimes we verify the collision logic (presence/absence
// of Map keys), which is TZ-independent.

import { describe, it, expect } from 'vitest';
import type { SessionContainerDTO } from '@kernel/models/session-container/session-container.dto';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';
import {
  formatTimeOfDay,
  buildUnnamedDayCollisionTimes,
} from './ClientSessionsPage.disambiguation';

// ---------------------------------------------------------------------------
// Minimal DTO factory
// ---------------------------------------------------------------------------
function makeSession(
  overrides: Partial<SessionContainerDTO> = {}
): SessionContainerDTO {
  return {
    id: 'sess-1',
    clientAccountId: 'client-1',
    clientName: null,
    clientUserId: null,
    stylistAccountId: null,
    name: null,
    lifecycleState: SessionContainerLifecycleStateValue.DRAFT,
    stylistNote: null,
    clientNote: null,
    sharedAt: null,
    expiresAt: null,
    closedAt: null,
    createdAt: '2026-06-10T09:00:00.000Z',
    updatedAt: '2026-06-10T09:00:00.000Z',
    photoCount: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatTimeOfDay
// ---------------------------------------------------------------------------
describe('formatTimeOfDay', () => {
  it('returns a string matching HH:MM format for a valid ISO timestamp', () => {
    // We only assert the shape (HH:MM), not the exact digits,
    // because the function deliberately uses LOCAL time which depends on TZ.
    const result = formatTimeOfDay('2026-06-10T09:00:00.000Z', 'pl');
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it('returns empty string for an invalid ISO string', () => {
    expect(formatTimeOfDay('not-a-date', 'pl')).toBe('');
  });

  it('returns empty string for an empty string input', () => {
    expect(formatTimeOfDay('', 'pl')).toBe('');
  });

  it('pads hours with leading zero (result always 2 digits before colon)', () => {
    // Any valid ISO → hours part is 2 digits
    const result = formatTimeOfDay('2026-06-10T09:00:00.000Z', 'en');
    const [hh, mm] = result.split(':');
    expect(hh?.length).toBe(2);
    expect(mm?.length).toBe(2);
  });

  it('accepts locale parameter without altering output (locale-neutral 24h)', () => {
    const iso = '2026-06-10T09:00:00.000Z';
    // All locales should return the same result for the same input
    expect(formatTimeOfDay(iso, 'pl')).toBe(formatTimeOfDay(iso, 'en'));
    expect(formatTimeOfDay(iso, 'en')).toBe(formatTimeOfDay(iso, 'de'));
  });
});

// ---------------------------------------------------------------------------
// buildUnnamedDayCollisionTimes
// ---------------------------------------------------------------------------
describe('buildUnnamedDayCollisionTimes', () => {
  it('returns an empty Map for an empty session list', () => {
    const result = buildUnnamedDayCollisionTimes([], 'pl');
    expect(result.size).toBe(0);
  });

  it('returns an empty Map when there is only one unnamed session (no collision)', () => {
    const sessions = [
      makeSession({ id: 'a', createdAt: '2026-06-10T09:00:00.000Z' }),
    ];
    const result = buildUnnamedDayCollisionTimes(sessions, 'pl');
    expect(result.size).toBe(0);
  });

  it('returns an empty Map when all sessions have distinct names (named = excluded)', () => {
    const sessions = [
      makeSession({
        id: 'a',
        name: 'Sesja A',
        createdAt: '2026-06-10T09:00:00.000Z',
      }),
      makeSession({
        id: 'b',
        name: 'Sesja B',
        createdAt: '2026-06-10T11:00:00.000Z',
      }),
    ];
    const result = buildUnnamedDayCollisionTimes(sessions, 'pl');
    expect(result.size).toBe(0);
  });

  it('includes both unnamed sessions when they share the same UTC calendar day', () => {
    const sessions = [
      makeSession({ id: 'a', createdAt: '2026-06-10T10:00:00.000Z' }),
      makeSession({ id: 'b', createdAt: '2026-06-10T14:00:00.000Z' }),
    ];
    const result = buildUnnamedDayCollisionTimes(sessions, 'pl');
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
    expect(result.size).toBe(2);
  });

  it('keys collisions on UTC day (matches the UTC displayed date), TZ-independent', () => {
    // Ratchet: two unnamed sessions on the SAME UTC day but far apart in wall-clock
    // (23:30Z and 02:00Z). formatAbsoluteDate renders both as "10 czerwca 2026"
    // (UTC), so they visually collide and MUST both get a time suffix. The old
    // LOCAL day-key split them into different buckets in +offset timezones (23:30Z
    // → next local day) → no suffix → un-disambiguated. UTC key = deterministic
    // collision regardless of the test runner's timezone.
    const sessions = [
      makeSession({ id: 'a', createdAt: '2026-06-10T23:30:00.000Z' }),
      makeSession({ id: 'b', createdAt: '2026-06-10T02:00:00.000Z' }),
    ];
    const result = buildUnnamedDayCollisionTimes(sessions, 'pl');
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
    expect(result.size).toBe(2);
  });

  it('excludes unnamed sessions on different days (no collision)', () => {
    const sessions = [
      makeSession({ id: 'a', createdAt: '2026-06-10T10:00:00.000Z' }),
      makeSession({ id: 'b', createdAt: '2026-06-11T10:00:00.000Z' }),
    ];
    const result = buildUnnamedDayCollisionTimes(sessions, 'pl');
    expect(result.size).toBe(0);
  });

  it('excludes named sessions even if they share a day with an unnamed session', () => {
    const sessions = [
      makeSession({
        id: 'unnamed',
        name: null,
        createdAt: '2026-06-10T10:00:00.000Z',
      }),
      makeSession({
        id: 'named',
        name: 'Real Name',
        createdAt: '2026-06-10T14:00:00.000Z',
      }),
    ];
    const result = buildUnnamedDayCollisionTimes(sessions, 'pl');
    // Only one unnamed on that day → no collision, no entry
    expect(result.size).toBe(0);
  });

  it('handles whitespace-only names as unnamed (same rule as resolveSessionDisplayName)', () => {
    const sessions = [
      makeSession({
        id: 'a',
        name: '   ',
        createdAt: '2026-06-10T10:00:00.000Z',
      }),
      makeSession({
        id: 'b',
        name: null,
        createdAt: '2026-06-10T14:00:00.000Z',
      }),
    ];
    const result = buildUnnamedDayCollisionTimes(sessions, 'pl');
    // Both are "unnamed" → collision → both appear
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
  });

  it('stores HH:MM values (shape) for colliding sessions', () => {
    const sessions = [
      makeSession({ id: 'a', createdAt: '2026-06-10T10:00:00.000Z' }),
      makeSession({ id: 'b', createdAt: '2026-06-10T14:00:00.000Z' }),
    ];
    const result = buildUnnamedDayCollisionTimes(sessions, 'pl');
    expect(result.get('a')).toMatch(/^\d{2}:\d{2}$/);
    expect(result.get('b')).toMatch(/^\d{2}:\d{2}$/);
  });

  it('uses sessionTimestamp priority (sharedAt > closedAt > createdAt) for day-key computation', () => {
    // Session 'a': sharedAt on day 10, createdAt on day 9
    // Session 'b': sharedAt on day 10, createdAt on day 8
    // Both should end up in the same day-bucket (day 10) via sharedAt.
    const sessions = [
      makeSession({
        id: 'a',
        sharedAt: '2026-06-10T10:00:00.000Z',
        createdAt: '2026-06-09T10:00:00.000Z',
      }),
      makeSession({
        id: 'b',
        sharedAt: '2026-06-10T14:00:00.000Z',
        createdAt: '2026-06-08T10:00:00.000Z',
      }),
    ];
    const result = buildUnnamedDayCollisionTimes(sessions, 'pl');
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
  });

  it('handles 3+ unnamed sessions on the same day (all receive a time entry)', () => {
    const sessions = [
      makeSession({ id: 'a', createdAt: '2026-06-10T08:00:00.000Z' }),
      makeSession({ id: 'b', createdAt: '2026-06-10T12:00:00.000Z' }),
      makeSession({ id: 'c', createdAt: '2026-06-10T16:00:00.000Z' }),
    ];
    const result = buildUnnamedDayCollisionTimes(sessions, 'pl');
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
    expect(result.has('c')).toBe(true);
    expect(result.size).toBe(3);
  });

  it('catches a same-day collision that straddles the active/archive split (mixed lists)', () => {
    // Simulates calling buildUnnamedDayCollisionTimes with the full combined list
    // where one session might be SHARED and the other DRAFT — they still collide if same day.
    const sessions = [
      makeSession({
        id: 'active',
        lifecycleState: SessionContainerLifecycleStateValue.SHARED,
        createdAt: '2026-06-10T09:00:00.000Z',
      }),
      makeSession({
        id: 'draft',
        lifecycleState: SessionContainerLifecycleStateValue.DRAFT,
        createdAt: '2026-06-10T15:00:00.000Z',
      }),
    ];
    const result = buildUnnamedDayCollisionTimes(sessions, 'pl');
    expect(result.has('active')).toBe(true);
    expect(result.has('draft')).toBe(true);
  });
});
