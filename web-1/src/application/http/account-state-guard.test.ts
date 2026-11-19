// The account-state gate (DOMAIN_SSOT §13.1) is a security boundary: an inactive account reaches business
// logic only through its state's allowlist. Every state is pinned against the FULL set of commands and
// queries, so adding an event to the wrong list (or removing a state branch) fails here.
import { describe, it, expect } from 'vitest';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { EVENT_COMMANDS_AND_QUERIES_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import type { CurrentUser } from '@kernel/models/user/user.types';
import { isAccountStateActionAllowed } from './account-state-guard';

const ALL_EVENTS = [
  ...Object.values(APP_EVENTS.COMMANDS),
  ...Object.values(APP_EVENTS.QUERIES),
].flatMap(group => Object.values(group)) as EVENT_COMMANDS_AND_QUERIES_TYPE[];

const user = (
  state: Pick<CurrentUser, 'is_active' | 'deleted_at' | 'recovery_available'>
): CurrentUser => state as unknown as CurrentUser;

const allowedFor = (currentUser: CurrentUser) =>
  new Set(
    ALL_EVENTS.filter(eventName =>
      isAccountStateActionAllowed({ currentUser, eventName })
    )
  );

const ALWAYS = [
  APP_EVENTS.QUERIES.SESSION.SESSION_GET_CURRENT,
  APP_EVENTS.COMMANDS.USER.USER_LOGOUT,
  APP_EVENTS.COMMANDS.ADMIN.SWITCH_BACK_BECOME_USER,
  APP_EVENTS.COMMANDS.ADMIN.REFRESH_IMPERSONATION,
];

const DELETED_AT = new Date('2026-10-01T00:00:00Z');

describe('isAccountStateActionAllowed', () => {
  it('the event universe is non-trivial (guards the fixture itself)', () => {
    expect(ALL_EVENTS.length).toBeGreaterThan(50);
    for (const event of ALWAYS) {
      expect(ALL_EVENTS).toContain(event);
    }
  });

  it('ACTIVE: every command and query passes, whatever the deletion markers say', () => {
    for (const currentUser of [
      user({ is_active: true, deleted_at: null, recovery_available: false }),
      user({
        is_active: true,
        deleted_at: DELETED_AT,
        recovery_available: false,
      }),
    ]) {
      expect(allowedFor(currentUser).size).toBe(ALL_EVENTS.length);
    }
  });

  it('RECOVERABLE (self-deleted, inside the window): read state, log out, leave impersonation, reactivate, erase', () => {
    expect(
      allowedFor(
        user({
          is_active: false,
          deleted_at: DELETED_AT,
          recovery_available: true,
        })
      )
    ).toEqual(
      new Set([
        ...ALWAYS,
        APP_EVENTS.COMMANDS.USER.USER_REACTIVATE_ACCOUNT,
        APP_EVENTS.COMMANDS.USER.USER_GDPR_ERASE,
      ])
    );
  });

  it('EXPIRED (self-deleted, window over): erase but NOT reactivate', () => {
    expect(
      allowedFor(
        user({
          is_active: false,
          deleted_at: DELETED_AT,
          recovery_available: false,
        })
      )
    ).toEqual(new Set([...ALWAYS, APP_EVENTS.COMMANDS.USER.USER_GDPR_ERASE]));
  });

  it('ADMIN-BAN / self-disable (inactive, never deleted): no self-action at all, recovery flag ignored', () => {
    for (const recovery_available of [true, false]) {
      expect(
        allowedFor(
          user({ is_active: false, deleted_at: null, recovery_available })
        )
      ).toEqual(new Set(ALWAYS));
    }
  });
});
