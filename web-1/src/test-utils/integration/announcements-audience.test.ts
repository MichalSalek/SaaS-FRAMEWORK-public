import { beforeEach, describe, expect, it } from 'vitest';
import handler from '../../pages/api/v1/announcements/active';
import { mockApiHandler, mockDb } from '../mockApiHandler';
import {
  __resetCurrentUser,
  __setAuthUnavailable,
  __setCurrentUser,
} from '../setup';
import {
  makeClientCurrentUser,
  makeCurrentUserOutput,
  makeStylistCurrentUser,
} from '../fixtures';
import {
  ANNOUNCEMENT_CACHE_KEY,
  announcementCache,
} from '@domain/admin/operations/admin-announcements.helpers';
import type { ActiveAnnouncementCache } from '@domain/admin/operations/admin-announcements.helpers';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';

const rows = [
  {
    id: 'public',
    audience_anonymous: true,
    audience_client: true,
    audience_stylist: true,
  },
  {
    id: 'stylist',
    audience_anonymous: false,
    audience_client: false,
    audience_stylist: true,
  },
  {
    id: 'client',
    audience_anonymous: false,
    audience_client: true,
    audience_stylist: false,
  },
].map(row => ({
  ...row,
  title: row.id,
  message: 'News',
  type: 'info',
  starts_at: null,
  ends_at: null,
  translations: { en: { title: row.id, message: 'News' } },
}));

beforeEach(() => {
  __resetCurrentUser();
  announcementCache.invalidate(ANNOUNCEMENT_CACHE_KEY);
  mockDb({ announcement: { findMany: async () => rows } });
});

const read = async (surface: 'public' | 'app') => {
  const response = await mockApiHandler<ActiveAnnouncementCache>(handler, {
    method: 'GET',
    query: { surface },
  });
  expect(response.status).toBe(200);
  return response.data.map(row => row.id);
};

describe('announcement public endpoint audience isolation', () => {
  it('returns only anonymous/public announcements to a guest', async () => {
    expect(await read('public')).toEqual(['public']);
    expect(await read('app')).toEqual([]);
  });
  it('uses the confirmed client role and never trusts a requested surface for role privileges', async () => {
    __setCurrentUser(makeCurrentUserOutput(makeClientCurrentUser()));
    expect(await read('app')).toEqual(['public', 'client']);
    expect(await read('public')).toEqual(['public']);
  });
  it('uses the confirmed stylist role without leaking those messages on public pages', async () => {
    __setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
    expect(await read('app')).toEqual(['public', 'stylist']);
    expect(await read('public')).toEqual(['public']);
  });
  it('an admin role alone grants no stylist/client audience', async () => {
    const admin = makeStylistCurrentUser({
      user: { role_id: SystemRoleId.MASTER_ADMIN },
    });
    __setCurrentUser(
      makeCurrentUserOutput({ ...admin, stylist_account: null })
    );
    expect(await read('app')).toEqual([]);
    expect(await read('public')).toEqual(['public']);
  });
  it('fails closed on auth infrastructure failure instead of serving private content or evicting the session', async () => {
    __setAuthUnavailable('SESSION');
    const response = await mockApiHandler(handler, {
      method: 'GET',
      query: { surface: 'app' },
    });
    expect(response.status).toBe(503);
    expect(response.event).toBe('AUTH_UNAVAILABLE');
  });
});
