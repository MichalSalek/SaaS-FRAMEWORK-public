import { describe, expect, it, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { makeStylistCurrentUser } from '../../../test-utils/fixtures';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import {
  getAllPermissions_IO,
  updateRolePermissions_IO,
} from './admin-permissions.operations';

describe('system role permissions remain immutable for master admin', () => {
  it.each(Object.values(SystemRoleId))(
    'rejects %s before changing permissions',
    async roleId => {
      const deleteMany = vi.fn();
      const createMany = vi.fn();
      mockDb({
        role: {
          findUnique: async () => ({
            id: roleId,
            name: roleId,
            is_system: true,
            permissions: [],
          }),
        },
        rolePermission: { deleteMany, createMany },
      });

      const currentUser = makeStylistCurrentUser({
        user: { role_id: SystemRoleId.MASTER_ADMIN },
      });
      const result = await updateRolePermissions_IO({
        roleId,
        permissionIds: ['test-permission'],
        currentUser,
      });

      expect(result).toEqual({
        success: false,
        error: { type: 'ADMIN_SYSTEM_ROLE_IMMUTABLE', roleId },
      });
      expect(deleteMany).not.toHaveBeenCalled();
      expect(createMany).not.toHaveBeenCalled();
    }
  );
});

describe('complete permission matrix', () => {
  it('reads beyond the former 200 permission limit in bounded batches', async () => {
    const permissions = Array.from({ length: 205 }, (_, index) => ({
      id: String(index).padStart(4, '0'),
      event_name: `PERMISSION_${index}`,
      category: 'USER',
      description: null,
      is_system: true,
    }));
    const findMany = vi.fn(
      async (args: {
        take: number;
        cursor?: { id: string };
        skip?: number;
      }) => {
        const offset = args.cursor
          ? permissions.findIndex(item => item.id === args.cursor?.id) +
            (args.skip ?? 0)
          : 0;
        return permissions.slice(offset, offset + args.take);
      }
    );
    mockDb({ role: { findMany: async () => [] }, permission: { findMany } });
    const result = await getAllPermissions_IO({
      currentUser: makeStylistCurrentUser({
        user: { role_id: SystemRoleId.MASTER_ADMIN },
      }),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.allPermissions).toHaveLength(205);
    }
    expect(findMany).toHaveBeenCalledTimes(3);
  });
});
