import { DB_CLIENT } from '@app/db/db.client';
import {
  invalidateFeatureFlagCache,
  getFeatureFlags,
} from '@app/feature-flags/feature-flags.cache';
import { PUBLIC_FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  AdminTargetNotFoundError,
  AdminInsufficientPermissionsError,
} from '@kernel/domain/admin/admin-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { FeatureFlagDTO } from '@kernel/models/admin/admin.dto';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import { QUERY_LIMITS } from '@kernel/domain/admin/admin.config';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { writeRawEventLog_IO } from '@app/event-log/event-log.client';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';

/**
 * Get all feature flags with metadata (admin view).
 */
export const adminGetFeatureFlags_IO = async ({
  currentUser,
}: {
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<
  OperationResult<
    FeatureFlagDTO[],
    AdminInsufficientPermissionsError | DatabaseError
  >
> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }
  try {
    const flags = await DB_CLIENT.use.featureFlag.findMany({
      orderBy: { key: 'asc' },
      take: QUERY_LIMITS.ADMIN_LIST_DEFAULT,
      select: {
        id: true,
        key: true,
        description: true,
        is_enabled: true,
        expires_at: true,
        updated_at: true,
      },
    });

    const result: FeatureFlagDTO[] = flags.map(flag => ({
      id: flag.id,
      key: flag.key,
      description: flag.description,
      is_enabled: flag.is_enabled,
      expires_at: flag.expires_at ? flag.expires_at.toISOString() : null,
      updated_at: flag.updated_at.toISOString(),
    }));

    return success(result);
  } catch (error) {
    return databaseFailure('adminGetFeatureFlags', error);
  }
};

/**
 * Toggle a feature flag (admin only).
 * Updates DB + invalidates cache.
 */
export const adminToggleFeatureFlag_IO = async ({
  key,
  is_enabled,
  currentUser,
}: {
  key: string;
  is_enabled: boolean;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<
  OperationResult<
    FeatureFlagDTO,
    AdminTargetNotFoundError | AdminInsufficientPermissionsError | DatabaseError
  >
> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }
  try {
    const existing = await DB_CLIENT.use.featureFlag.findUnique({
      where: { key },
    });

    if (!existing) {
      return failure({
        type: 'ADMIN_TARGET_NOT_FOUND',
        targetId: key,
        targetType: 'RECORD',
      });
    }

    const updated = await DB_CLIENT.use.featureFlag.update({
      where: { key },
      // DECISION: enabling clears a stale expires_at. Otherwise feature-flag-expiry.interceptor
      // matches the past expiry and flips the flag straight back to false (enable/auto-disable
      // loop). Disabling leaves expires_at untouched (retirement metadata).
      data: { is_enabled, ...(is_enabled ? { expires_at: null } : {}) },
    });

    // Invalidate cache after toggle
    invalidateFeatureFlagCache();

    // DECISION: the admin config audit is awaited so the row persists before the response, with
    // before/after values. flag_key is in the payload because the EventLog FK points at the user,
    // not the flag; without it a reviewer cannot tell which flag changed.
    await writeRawEventLog_IO({
      eventName: APP_EVENTS.INFO.ADMIN.FEATURE_FLAG_TOGGLED,
      eventLogType: EventLogTypeValue.ADMIN,
      meta: {
        created_by_user_id: currentUser.id,
      },
      eventPayloadToStringify: {
        flag_id: updated.id,
        flag_key: updated.key,
        before_value: existing.is_enabled,
        after_value: updated.is_enabled,
      },
    });

    return success({
      id: updated.id,
      key: updated.key,
      description: updated.description,
      is_enabled: updated.is_enabled,
      expires_at: updated.expires_at ? updated.expires_at.toISOString() : null,
      updated_at: updated.updated_at.toISOString(),
    });
  } catch (error) {
    return databaseFailure('adminToggleFeatureFlag', error);
  }
};

/**
 * Get feature flags for public consumption (minimal payload).
 * Returns Record<string, boolean> — no admin metadata.
 */
export const getFeatureFlagsPublic_IO = async (): Promise<
  OperationResult<Record<string, boolean>, DatabaseError>
> => {
  try {
    const flags = await getFeatureFlags();
    // SECURITY: expose ONLY the whitelisted public flags (consumed by anonymous-
    // reachable UI — PublicFooter/AppLayout). Internal flags (e.g. SALON_STAFF_ENABLED,
    // read backend-side in the salon/staff handlers) must NOT leak to unauthenticated
    // callers; admin view uses adminGetFeatureFlags_IO (MASTER_ADMIN-gated).
    const result: Record<string, boolean> = {};
    for (const key of PUBLIC_FEATURE_FLAG_KEYS) {
      const value = flags.get(key);
      if (value !== undefined) {
        result[key] = value;
      }
    }
    return success(result);
  } catch (error) {
    return databaseFailure('getFeatureFlagsPublic', error);
  }
};

/**
 * System sweep: auto-disable feature flags whose expires_at has passed.
 * No auth gate — invoked by featureFlagExpiryInterceptor (request-driven, 24h throttle).
 * The WHERE matches only enabled, expired rows, so a re-run on already-disabled or
 * non-expiring rows changes nothing (no test pins the re-run).
 * Enforces expires_at at runtime (the admin view only displayed it).
 */
export const expireFeatureFlags_IO = async (): Promise<
  OperationResult<{ expired: number }, DatabaseError>
> => {
  try {
    const result = await DB_CLIENT.use.featureFlag.updateMany({
      where: {
        expires_at: { not: null, lt: new Date() },
        is_enabled: true,
      },
      data: { is_enabled: false },
    });

    if (result.count > 0) {
      invalidateFeatureFlagCache();
    }

    return success({ expired: result.count });
  } catch (error) {
    return databaseFailure('expireFeatureFlags', error);
  }
};
