/**
 * Integration-handler — invitee side of salon-team invitations.
 *
 * GET  /api/v1/salon/invitations          (SALON_STAFF_GET_MY_INVITATIONS)
 * POST /api/v1/salon/invitations/respond  (SALON_STAFF_RESPOND_INVITATION)
 *
 * Runs through the real middleware with the REAL permission matrix
 * (__setPermission(null)), so the LOGGED_USER placement is measured: a stylist
 * browsing in client mode (role CLIENT) must still reach both endpoints.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import listHandler from '../../pages/api/v1/salon/invitations/index';
import respondHandler from '../../pages/api/v1/salon/invitations/respond/index';
import { mockApiHandler, mockDb } from '../mockApiHandler';
import {
  __setCurrentUser,
  __resetCurrentUser,
  __setPermission,
} from '../setup';
import {
  makeCurrentUserOutput,
  makeStylistCurrentUser,
  makeClientCurrentUser,
} from '../fixtures';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import { invalidateFeatureFlagCache } from '@app/feature-flags/feature-flags.cache';
import type { SALON_STAFF_DTO_API_V1 } from '@kernel/models/salon-staff/salon-staff.dto';

const STAFF_ID = 'stf_0000000000000000001';

const flags = (enabled: boolean) => ({
  findMany: async () => [
    { key: FEATURE_FLAG_KEYS.SALON_STAFF_ENABLED, is_enabled: enabled },
  ],
});

const pendingRow = {
  id: STAFF_ID,
  stylist_account_id: 'sa_00000000000000000001',
  role: 'EMPLOYEE',
  invited_at: new Date('2026-09-20T10:00:00.000Z'),
  stylist_account: {
    display_name: 'Ola Nails',
    business_name: null,
    avatar_url: null,
    created_by_user: { name: 'Ola', image: null },
  },
};

describe('GET /api/v1/salon/invitations', () => {
  beforeEach(() => {
    invalidateFeatureFlagCache();
    __setPermission(null);
    __setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
  });

  it('stylist → 200 with her pending invitations', async () => {
    mockDb({
      featureFlag: flags(true),
      staffMember: { findMany: async () => [pendingRow] },
    });

    const { status, event, data } = await mockApiHandler<
      SALON_STAFF_DTO_API_V1['SALON_STAFF_GET_MY_INVITATIONS']['RESPONSE']
    >(listHandler, { method: 'GET' });

    expect(status).toBe(200);
    expect(event).toBe(
      APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITATIONS_FETCHED
    );
    expect(data.invitations).toEqual([
      {
        staff_member_id: STAFF_ID,
        salon_account_id: 'sa_00000000000000000001',
        inviter_name: 'Ola Nails',
        salon_name: null,
        owner_avatar_url: null,
        role: 'EMPLOYEE',
        invited_at: '2026-09-20T10:00:00.000Z',
      },
    ]);
  });

  it('user in client mode (role CLIENT) → 200, not 403 (LOGGED_USER permission)', async () => {
    __setCurrentUser(makeCurrentUserOutput(makeClientCurrentUser()));
    mockDb({
      featureFlag: flags(true),
      staffMember: { findMany: async () => [] },
    });

    const { status, data } = await mockApiHandler<
      SALON_STAFF_DTO_API_V1['SALON_STAFF_GET_MY_INVITATIONS']['RESPONSE']
    >(listHandler, { method: 'GET' });

    expect(status).toBe(200);
    expect(data.invitations).toEqual([]);
  });

  it('SALON_STAFF_ENABLED off → 404', async () => {
    mockDb({ featureFlag: flags(false) });

    const { status } = await mockApiHandler(listHandler, { method: 'GET' });

    expect(status).toBe(404);
  });

  it('anonymous → 401', async () => {
    __resetCurrentUser();
    mockDb({ featureFlag: flags(true) });

    const { status } = await mockApiHandler(listHandler, { method: 'GET' });

    expect(status).toBe(401);
  });
});

describe('POST /api/v1/salon/invitations/respond', () => {
  beforeEach(() => {
    invalidateFeatureFlagCache();
    __setPermission(null);
    __setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
  });

  it('ACCEPT → 200 ACCEPTED + SALON_STAFF_INVITATION_ACCEPTED', async () => {
    mockDb({
      featureFlag: flags(true),
      staffMember: { updateMany: async () => ({ count: 1 }) },
    });

    const { status, event, data } = await mockApiHandler<
      SALON_STAFF_DTO_API_V1['SALON_STAFF_RESPOND_INVITATION']['RESPONSE']
    >(respondHandler, {
      method: 'POST',
      body: { staff_member_id: STAFF_ID, response: 'ACCEPT' },
    });

    expect(status).toBe(200);
    expect(event).toBe(
      APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITATION_ACCEPTED
    );
    expect(data.status).toBe('ACCEPTED');
    expect(typeof data.accepted_at).toBe('string');
  });

  it('DECLINE → 200 DECLINED + SALON_STAFF_INVITATION_DECLINED', async () => {
    mockDb({
      featureFlag: flags(true),
      staffMember: { deleteMany: async () => ({ count: 1 }) },
    });

    const { status, event, data } = await mockApiHandler<
      SALON_STAFF_DTO_API_V1['SALON_STAFF_RESPOND_INVITATION']['RESPONSE']
    >(respondHandler, {
      method: 'POST',
      body: { staff_member_id: STAFF_ID, response: 'DECLINE' },
    });

    expect(status).toBe(200);
    expect(event).toBe(
      APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITATION_DECLINED
    );
    expect(data).toEqual({
      staff_member_id: STAFF_ID,
      status: 'DECLINED',
      accepted_at: null,
    });
  });

  it('ACCEPT of an invitation that is not hers → 404 NOT_FOUND', async () => {
    mockDb({
      featureFlag: flags(true),
      staffMember: {
        updateMany: async () => ({ count: 0 }),
        findFirst: async () => null,
      },
    });

    const { status, event } = await mockApiHandler(respondHandler, {
      method: 'POST',
      body: { staff_member_id: STAFF_ID, response: 'ACCEPT' },
    });

    expect(status).toBe(404);
    expect(event).toBe(APP_EVENTS.INFO.APPLICATION.NOT_FOUND);
  });

  it('unknown answer → 400 before any DB call', async () => {
    mockDb({ featureFlag: flags(true) });

    const { status, event } = await mockApiHandler(respondHandler, {
      method: 'POST',
      body: { staff_member_id: STAFF_ID, response: 'MAYBE' },
    });

    expect(status).toBe(400);
    expect(event).toBe(APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED);
  });

  it('missing staff_member_id → 400', async () => {
    mockDb({ featureFlag: flags(true) });

    const { status } = await mockApiHandler(respondHandler, {
      method: 'POST',
      body: { response: 'ACCEPT' },
    });

    expect(status).toBe(400);
  });

  it('GET on the command route → rejected (method guard)', async () => {
    mockDb({ featureFlag: flags(true) });

    const { status } = await mockApiHandler(respondHandler, { method: 'GET' });

    expect(status).toBeGreaterThanOrEqual(400);
  });
});
