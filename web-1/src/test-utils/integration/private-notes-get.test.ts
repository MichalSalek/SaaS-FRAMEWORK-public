/**
 * Integration-handler — GET account/get-private-notes (the stylist's notes hub).
 *
 * Drives the real handler through production middleware: a stylist gets 200 with
 * the three lists, a CLIENT account is refused by requireStylistAccount (403),
 * an over-long client filter is a 400.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import handler from '../../pages/api/v1/account/get-private-notes/index';
import { mockApiHandler, mockDb } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import {
  makeCurrentUserOutput,
  makeStylistCurrentUser,
  makeClientCurrentUser,
} from '../fixtures';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

describe('GET /api/v1/account/get-private-notes (handler integration)', () => {
  beforeEach(() => {
    __setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
    __setPermission(true);
    mockDb({
      sessionContainer: { findMany: async () => [] },
      clientStylistPair: { findMany: async () => [] },
      visitRecord: { findMany: async () => [] },
    });
  });

  it('stylist → 200 with the hub payload', async () => {
    const { status, data } = await mockApiHandler<{
      history_locked: boolean;
      session_notes: unknown[];
      client_notes: unknown[];
      visit_notes: unknown[];
    }>(handler, { method: 'GET' });

    expect(status).toBe(200);
    expect(data.session_notes).toEqual([]);
    expect(data.client_notes).toEqual([]);
    expect(data.visit_notes).toEqual([]);
    expect(typeof data.history_locked).toBe('boolean');
  });

  it('CLIENT account → 403 UNAUTHORIZED', async () => {
    __setCurrentUser(makeCurrentUserOutput(makeClientCurrentUser()));
    const { status, event } = await mockApiHandler(handler, { method: 'GET' });
    expect(status).toBe(403);
    expect(event).toBe(APP_EVENTS.INFO.USER.UNAUTHORIZED);
  });

  it('over-long client filter → 400', async () => {
    const { status } = await mockApiHandler(handler, {
      method: 'GET',
      query: { client_user_id: 'x'.repeat(200) },
    });
    expect(status).toBe(400);
  });
});
