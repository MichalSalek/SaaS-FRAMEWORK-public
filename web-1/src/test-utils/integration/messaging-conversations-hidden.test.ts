/**
 * Integration-handler test — GET /messaging/conversations `hidden` query.
 *
 * Pins that `hidden=true` reaches getConversations_IO as hidden:true
 * (where = IS NOT NULL) and that the default (no param) uses IS NULL.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import conversationsHandler from '../../pages/api/v1/messaging/conversations/index';
import { mockApiHandler, mockDb } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import { makeCurrentUserOutput, makeStylistCurrentUser } from '../fixtures';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

type FindManyWhere = {
  client_user_id?: string;
  stylist_account_id?: string;
  client_hidden_at?: unknown;
  stylist_hidden_at?: unknown;
};

const whereOf = (
  findMany: ReturnType<typeof vi.fn>,
  side: 'client' | 'stylist'
): FindManyWhere | undefined => {
  const call = findMany.mock.calls.find(entry => {
    const where = (entry[0] as { where?: FindManyWhere } | undefined)?.where;
    return side === 'client'
      ? where?.client_user_id !== undefined
      : where?.stylist_account_id !== undefined;
  });
  return (call?.[0] as { where?: FindManyWhere } | undefined)?.where;
};

describe('messaging conversations hidden query (handler integration)', () => {
  beforeEach(() => {
    __setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
    __setPermission(true);
  });

  it('GET ?hidden=true → where uses {not:null} on both side branches', async () => {
    const findMany = vi.fn(async () => []);
    mockDb({
      clientStylistPair: { findMany },
    });

    const { status, event } = await mockApiHandler(conversationsHandler, {
      method: 'GET',
      query: { hidden: 'true' },
    });

    expect(status).toBe(200);
    expect(event).toBe(
      APP_EVENTS.INFO.MESSAGING.MESSAGING_CONVERSATIONS_FETCHED
    );
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(whereOf(findMany, 'client')).toMatchObject({
      client_hidden_at: { not: null },
    });
    expect(whereOf(findMany, 'stylist')).toMatchObject({
      stylist_hidden_at: { not: null },
    });
  });

  it('GET without hidden → default IS NULL on both side branches', async () => {
    const findMany = vi.fn(async () => []);
    mockDb({
      clientStylistPair: { findMany },
    });

    const { status } = await mockApiHandler(conversationsHandler, {
      method: 'GET',
    });

    expect(status).toBe(200);
    expect(whereOf(findMany, 'client')).toMatchObject({
      client_hidden_at: null,
    });
    expect(whereOf(findMany, 'stylist')).toMatchObject({
      stylist_hidden_at: null,
    });
  });
});
