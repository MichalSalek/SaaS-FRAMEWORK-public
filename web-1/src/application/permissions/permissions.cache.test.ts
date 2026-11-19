/**
 * checkPermission tells a real refusal from a failed custom-role permission read
 * and keeps system roles off the database.
 */
import { describe, expect, it, vi } from 'vitest';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { mockDb } from '../../test-utils/mockApiHandler';
import type * as PermissionsCacheModule from './permissions.cache';

const { checkPermission } = await vi.importActual<
  typeof PermissionsCacheModule
>('./permissions.cache');

const EVENT = APP_EVENTS.QUERIES.FAVORITE.FAVORITE_GET_RECORDS;
const CUSTOM_ROLE_ID = 'role_custom_review_f2';

describe('checkPermission', () => {
  it('custom role: a failed DB read is UNAVAILABLE, never a grant', async () => {
    mockDb({
      rolePermission: {
        findFirst: async () => {
          throw new Error('relation "RolePermission" does not exist');
        },
      },
    });
    expect(
      await checkPermission({ roleId: CUSTOM_ROLE_ID, eventName: EVENT })
    ).toEqual({
      hasPermission: false,
      roleId: CUSTOM_ROLE_ID,
      reason: 'UNAVAILABLE',
    });
  });

  it('custom role: no row is a real DENIED', async () => {
    mockDb({ rolePermission: { findFirst: async () => null } });
    expect(
      await checkPermission({ roleId: CUSTOM_ROLE_ID, eventName: EVENT })
    ).toEqual({
      hasPermission: false,
      roleId: CUSTOM_ROLE_ID,
      reason: 'DENIED',
    });
  });

  it('system roles never read the database', async () => {
    const findFirst = vi.fn(async () => {
      throw new Error('must not be called');
    });
    mockDb({ rolePermission: { findFirst } });
    expect(
      await checkPermission({
        roleId: SystemRoleId.CLIENT_ROLE,
        eventName: EVENT,
      })
    ).toMatchObject({ hasPermission: true });
    expect(
      await checkPermission({
        roleId: SystemRoleId.STYLIST_ROLE,
        eventName: EVENT,
      })
    ).toEqual({
      hasPermission: false,
      roleId: SystemRoleId.STYLIST_ROLE,
      reason: 'DENIED',
    });
    expect(findFirst).not.toHaveBeenCalled();
  });
});
