/**
 * Permissions System - Main initialization module
 *
 * This module orchestrates:
 * 1. Seeding system roles and permissions on app startup
 *
 * Implementation is split across:
 * - permissions.config.ts - SSOT for default role permissions
 * - permissions.seed.ts - Database seeding logic
 * - permissions.cache.ts - Permission checks (in-memory Sets for system roles, DB for custom roles)
 *
 * NOTE: System roles are answered from immutable in-memory Sets built at module
 * load from the SSOT config (no TTL, no invalidation). Only custom (non-system)
 * roles query the DB, uncached, on every check. See permissions.cache.ts.
 */

import {
  seedSystemRoles,
  seedSystemPermissions,
  seedDefaultRolePermissions,
} from './permissions.seed';
import { reportIssueBackend } from '@app/debugger/error-handler';

// Re-export public API
export { checkPermission } from './permissions.cache';

/**
 * Main initialization function - called on app startup
 */
export const initializePermissionsSystem = async (): Promise<void> => {
  reportIssueBackend({
    namespace: 'PERMISSIONS',
    message: 'Initializing permissions system',
    payload: null,
    mode: 'warn',
  });

  try {
    // 1. Seed system roles
    await seedSystemRoles();
    reportIssueBackend({
      namespace: 'PERMISSIONS',
      message: 'System roles seeded',
      payload: null,
      mode: 'warn',
    });

    // 2. Seed all permissions from EVENTS
    await seedSystemPermissions();
    reportIssueBackend({
      namespace: 'PERMISSIONS',
      message: 'System permissions seeded',
      payload: null,
      mode: 'warn',
    });

    // 3. Seed default role-permission mappings
    await seedDefaultRolePermissions();
    reportIssueBackend({
      namespace: 'PERMISSIONS',
      message: 'Default role permissions seeded',
      payload: null,
      mode: 'warn',
    });

    reportIssueBackend({
      namespace: 'PERMISSIONS',
      message: 'Initialization complete',
      payload: null,
      mode: 'warn',
    });
  } catch (error) {
    reportIssueBackend({
      namespace: 'PERMISSIONS',
      message: 'Initialization failed',
      payload:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : error,
      mode: 'error',
    });
    throw error;
  }
};
