/**
 * Permissions Seeding - Database initialization
 *
 * This module handles seeding of:
 * - System roles
 * - System permissions (from EVENTS config)
 * - Default role-permission mappings
 */

import { DB_CLIENT } from '@app/db/db.client';
import { EVENTS } from '@kernel/domain/commands-and-queries/cqrs.config';
import type { GROUP_KEY } from '@kernel/domain/commands-and-queries/cqrs.types';
import {
  SystemRoleId,
  type SystemRoleIdType,
} from '@kernel/models/db_models.manual.dto';
import {
  SYSTEM_ROLES_META,
  BASE_PERMISSIONS,
  LOGGED_USER_PERMISSIONS,
  STYLIST_SPECIFIC_PERMISSIONS,
  CLIENT_SPECIFIC_PERMISSIONS,
  SELF_ONLY_EVENTS,
} from './permissions.config';

// Permission categories derived from EVENTS groups (must match GROUP_KEY from cqrs.types)
// DECISION (nie usuwaj tego komentarza):
// PermissionCategory accepts GROUP_KEY (COMMANDS/QUERIES domain names: ADMIN, USER, etc.)
// OR 'LINK' for CONFIRMATIONS events. DB column `category` stores the group name.
type PermissionCategory = GROUP_KEY | 'LINK';

/**
 * Get all command, query and confirmation events from EVENTS config
 */
const getAllEvents = (): Array<{
  event_name: string;
  category: PermissionCategory;
}> => {
  const events: Array<{ event_name: string; category: PermissionCategory }> =
    [];

  const processGroup = (group: 'COMMANDS' | 'QUERIES') => {
    const categories = Object.keys(EVENTS[group]) as GROUP_KEY[];
    for (const category of categories) {
      const categoryEvents = EVENTS[group][category] as readonly string[];
      for (const event of categoryEvents) {
        events.push({
          event_name: event,
          category: category as PermissionCategory,
        });
      }
    }
  };

  const processConfirmations = () => {
    const categories = Object.keys(EVENTS.CONFIRMATIONS) as Array<
      keyof typeof EVENTS.CONFIRMATIONS
    >;
    for (const category of categories) {
      const categoryEvents = EVENTS.CONFIRMATIONS[
        category
      ] as readonly string[];
      for (const event of categoryEvents) {
        events.push({
          event_name: event,
          category: category as PermissionCategory,
        });
      }
    }
  };

  processGroup('COMMANDS');
  processGroup('QUERIES');
  processConfirmations();

  return events;
};

/**
 * Get default permissions for each system role
 */
const getDefaultRolePermissions = (): Record<SystemRoleIdType, string[]> => ({
  [SystemRoleId.NOT_LOGGED_IN]: [...BASE_PERMISSIONS],

  [SystemRoleId.CLIENT_ROLE]: [
    ...LOGGED_USER_PERMISSIONS,
    ...CLIENT_SPECIFIC_PERMISSIONS,
  ],

  [SystemRoleId.STYLIST_ROLE]: [
    ...LOGGED_USER_PERMISSIONS,
    ...STYLIST_SPECIFIC_PERMISSIONS,
  ],

  [SystemRoleId.MASTER_ADMIN]: getAllEvents()
    .map(e => e.event_name)
    .filter(e => !(SELF_ONLY_EVENTS as readonly string[]).includes(e)),
});

/**
 * Initialize system roles in database
 * Uses createMany + updateMany for true batch (2 queries)
 */
export const seedSystemRoles = async (): Promise<void> => {
  const roleIds = Object.values(SystemRoleId) as SystemRoleIdType[];
  const data = roleIds.map(id => {
    const meta = SYSTEM_ROLES_META[id];
    return {
      id,
      name: meta.name,
      description: meta.description,
      is_system: true,
    };
  });

  // 1. Insert new roles
  await DB_CLIENT.use.role.createMany({ data, skipDuplicates: true });

  // 2. Update existing roles
  await DB_CLIENT.use.$transaction(
    data.map(role =>
      DB_CLIENT.use.role.updateMany({
        where: { id: role.id },
        data: {
          name: role.name,
          description: role.description,
          is_system: true,
        },
      })
    )
  );
};

/**
 * Initialize all permissions in database (from EVENTS config)
 * Uses createMany for new + updateMany for existing (2 queries total)
 */
export const seedSystemPermissions = async (): Promise<void> => {
  const events = getAllEvents();

  // 1. Insert new permissions (skip existing)
  await DB_CLIENT.use.permission.createMany({
    data: events.map(({ event_name, category }) => ({
      event_name,
      category,
      description: null,
      is_system: true,
    })),
    skipDuplicates: true,
  });

  // 2. Update existing permissions (category might have changed)
  // Group by category for batch updates
  const byCategory = events.reduce<Record<string, string[]>>(
    (acc, { event_name, category }) => {
      if (acc[category] == null) {
        acc[category] = [];
      }
      acc[category].push(event_name);
      return acc;
    },
    {}
  );

  await DB_CLIENT.use.$transaction(
    Object.entries(byCategory).map(([category, eventNames]) =>
      DB_CLIENT.use.permission.updateMany({
        where: { event_name: { in: eventNames } },
        data: { category, is_system: true },
      })
    )
  );
};

/**
 * Initialize default role-permission mappings
 * Full reconciliation: deletes stale mappings + creates new ones
 * Ensures DB matches config EXACTLY after each seed
 */
export const seedDefaultRolePermissions = async (): Promise<void> => {
  const defaultPermissions = getDefaultRolePermissions();

  // Load all permissions once
  const allPermissions = await DB_CLIENT.use.permission.findMany({
    select: { id: true, event_name: true },
    take: 2000, // Safety limit — permissions are bounded by EVENTS config; 2000 far exceeds any realistic permission set
  });
  const permissionMap = new Map(allPermissions.map(p => [p.event_name, p.id]));

  // Collect all role-permission pairs
  const data: Array<{ role_id: string; permission_id: string }> = [];

  for (const [roleId, eventNames] of Object.entries(defaultPermissions)) {
    for (const eventName of eventNames) {
      const permissionId = permissionMap.get(eventName);
      if (permissionId) {
        data.push({ role_id: roleId, permission_id: permissionId });
      }
    }
  }

  const systemRoleIds = Object.values(SystemRoleId) as SystemRoleIdType[];

  await DB_CLIENT.use.$transaction([
    // Delete all existing system role permissions (full reset)
    DB_CLIENT.use.rolePermission.deleteMany({
      where: { role_id: { in: systemRoleIds } },
    }),
    // Re-create from config
    DB_CLIENT.use.rolePermission.createMany({ data, skipDuplicates: true }),
  ]);
};
