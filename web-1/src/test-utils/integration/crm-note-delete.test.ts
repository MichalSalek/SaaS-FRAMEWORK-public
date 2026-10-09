/**
 * Integration-handler — POST client/crm-note/delete (D4).
 *
 * Drives the real handler through production middleware. Pins the HTTP contract:
 * stylist wipe is always 200 + null payload; a CLIENT account hits
 * requireStylistAccount; missing client_user_id is validation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import handler from '../../pages/api/v1/client/crm-note/delete/index';
import { mockApiHandler, mockDb } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import {
  makeCurrentUserOutput,
  makeStylistCurrentUser,
  makeClientCurrentUser,
} from '../fixtures';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';

const CLIENT_USER_ID = 'usr_test_0000000000000002';

describe('POST /api/v1/client/crm-note/delete (handler integration)', () => {
  beforeEach(() => {
    __setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
    __setPermission(true);
  });

  it('stylist → 200 + CLIENT_CRM_NOTE_DELETED + {note:null, updatedAt:null}', async () => {
    mockDb({
      clientStylistPair: {
        updateMany: async () => ({ count: 1 }),
      },
    });

    const { status, event, data } = await mockApiHandler<{
      note: null;
      updatedAt: null;
    }>(handler, {
      method: 'POST',
      body: { client_user_id: CLIENT_USER_ID },
    });

    expect(status).toBe(200);
    expect(event).toBe(APP_EVENTS.INFO.CLIENT.CLIENT_CRM_NOTE_DELETED);
    expect(data).toEqual({ note: null, updatedAt: null });
  });

  it('CLIENT account → requireStylistAccount maps to 403 UNAUTHORIZED/WRONG_ACCOUNT_TYPE (logged-in role refusal, S122)', async () => {
    __setCurrentUser(makeCurrentUserOutput(makeClientCurrentUser()));

    const { status, event, data } = await mockApiHandler<{
      reason: string;
      requiredAccountType: string;
    }>(handler, {
      method: 'POST',
      body: { client_user_id: CLIENT_USER_ID },
    });

    expect(status).toBe(403);
    expect(event).toBe(APP_EVENTS.INFO.USER.UNAUTHORIZED);
    expect(data).toEqual({
      reason: 'WRONG_ACCOUNT_TYPE',
      requiredAccountType: AccountTypeValue.STYLIST,
    });
  });

  it('missing client_user_id → 400 VALIDATION_FAILED', async () => {
    const { status, event } = await mockApiHandler(handler, {
      method: 'POST',
      body: {},
    });

    expect(status).toBe(400);
    expect(event).toBe(APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED);
  });
});
