import { FREE_EMAIL_CONFIG } from '@kernel/domain/email/email-free.config';
import { initializeFreeEmailCampaign_IO } from '@domain/email/operations/free-email.enrollment';
import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type { AdminInsufficientPermissionsError } from '@kernel/domain/admin/admin-errors.types';
import type {
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import type {
  ADMIN_DTO_API_V1,
  RuntimeConfigEntry,
} from '@kernel/models/admin/admin.dto';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { createCache } from '@app/cache/cache.utils';
import { CACHE_TTL } from '@kernel/domain/admin/admin.config';
import { databaseFailure } from '@app/errors/error-result.helpers';
import {
  assertType,
  isRuntimeConfigValueTypeNarrower,
} from '@kernel/models/type_narrowing';
import type {
  RuntimeConfigKey,
  RuntimeConfigValueType,
} from '@kernel/domain/admin/runtime-config.config';
import { writeRawEventLog_IO } from '@app/event-log/event-log.client';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import { applyDebuggerRuntimeConfig } from '@app/debugger/debugger.state';

type ConfigsError = AdminInsufficientPermissionsError | DatabaseError;
type UpdateConfigError =
  AdminInsufficientPermissionsError | DatabaseError | ValidationError;

// DECISION: per-instance in-memory cache (local Map, CACHE_TTL.RUNTIME_CONFIG = 5 min). invalidate()
// clears only this process, so other workers, replicas and dev route bundles see a change after at
// most the TTL. That eventual consistency is by design (ADR-008, no Redis, docs/DECISION_LOG.md): do
// NOT add cross-instance invalidation, pub/sub or a shorter TTL. Revisit only at the ADR-008 threshold.
const runtimeConfigCache = createCache<string>(CACHE_TTL.RUNTIME_CONFIG);

/**
 * Invalidates the cache entry for ONE runtime-config key.
 *
 * DECISION: VERBOSE_LOG_MODE has a second writer, adminSwitchBackendDebugMode_IO, which could not
 * clear this module-private cache, so the public projection served the old value until the TTL ran
 * out. Exported as a narrow per-key function, not the cache itself: the other writer may invalidate
 * a key, not touch the structure.
 */
export const invalidateRuntimeConfigCache = (key: RuntimeConfigKey): void => {
  runtimeConfigCache.invalidate(key);
};

const mapToEntry = (config: {
  id: string;
  key: string;
  value: string;
  value_type: string;
  description: string | null;
  is_predefined: boolean;
  updated_at: Date;
}): RuntimeConfigEntry => ({
  id: config.id,
  key: config.key,
  value: config.value,
  value_type: assertType(
    config.value_type,
    isRuntimeConfigValueTypeNarrower,
    'RuntimeConfigValueType'
  ),
  description: config.description,
  is_predefined: config.is_predefined,
  updated_at: config.updated_at.toISOString(),
});

export const getAllRuntimeConfigs_IO = async ({
  currentUser,
}: {
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<
  OperationResult<
    ADMIN_DTO_API_V1['ADMIN_GET_CONFIGS']['RESPONSE'],
    ConfigsError
  >
> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  try {
    const configs = await DB_CLIENT.use.runtimeConfig.findMany({
      orderBy: { key: 'asc' },
      take: 500,
    });

    return success({
      configs: configs.map(mapToEntry),
    });
  } catch (error) {
    return databaseFailure('getAllRuntimeConfigs', error);
  }
};

export const updateRuntimeConfig_IO = async ({
  currentUser,
  params,
}: {
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
  params: ADMIN_DTO_API_V1['ADMIN_UPDATE_CONFIG']['REQUEST'];
}): Promise<
  OperationResult<
    ADMIN_DTO_API_V1['ADMIN_UPDATE_CONFIG']['RESPONSE'],
    UpdateConfigError
  >
> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  try {
    // Find existing config
    const existing = await DB_CLIENT.use.runtimeConfig.findUnique({
      where: { key: params.key },
    });

    if (!existing) {
      return failure({
        type: 'VALIDATION_ERROR',
        message: `Config key '${params.key}' does not exist`,
        field: 'key',
      });
    }

    // Validate value against type.
    // existing.value_type is `string` from Prisma — narrow to the domain union before validation.
    const narrowedValueType = assertType(
      existing.value_type,
      isRuntimeConfigValueTypeNarrower,
      'RuntimeConfigValueType (updateRuntimeConfig)'
    );
    const typeValidation = validateValueType(
      params.key,
      params.value,
      narrowedValueType
    );
    if (typeValidation !== null) {
      return failure({
        type: 'VALIDATION_ERROR',
        message: typeValidation,
        field: 'value',
      });
    }

    // Update in DB
    const updated = await DB_CLIENT.use.$transaction(async tx => {
      const config = await tx.runtimeConfig.update({
        where: { key: params.key },
        data: {
          value: params.value,
          updated_by_user_id: currentUser.id,
        },
      });
      if (params.key === 'FREE_EMAIL_MODE') {
        await tx.emailLifecycleCampaign.upsert({
          where: { id: FREE_EMAIL_CONFIG.CAMPAIGN_ID },
          create: {
            id: FREE_EMAIL_CONFIG.CAMPAIGN_ID,
            mode: params.value,
            startedAt: new Date(),
          },
          update: { mode: params.value },
        });
      }
      return config;
    });
    if (params.key === 'FREE_EMAIL_MODE' && params.value !== 'OFF') {
      await initializeFreeEmailCampaign_IO();
    }

    // Invalidate cache
    runtimeConfigCache.invalidate(params.key);

    // Same-process event-driven update for operational debugger toggles. This replaces
    // the old permanent DB poll while preserving instant admin behavior in this
    // process. Other runtime keys have no in-memory mirror.
    if (
      params.key === 'VERBOSE_LOG_MODE' ||
      params.key === 'API_TIMING_DEBUG_MODE'
    ) {
      applyDebuggerRuntimeConfig(params.key, updated.value);
    }

    // Runtime config can change production behavior: keep before/after values for rollback.
    await writeRawEventLog_IO({
      eventName: APP_EVENTS.INFO.ADMIN.CONFIG_UPDATED,
      eventLogType: EventLogTypeValue.ADMIN,
      meta: {
        created_by_user_id: currentUser.id,
      },
      eventPayloadToStringify: {
        config_id: updated.id,
        config_key: updated.key,
        value_type: updated.value_type,
        before_value: existing.value,
        after_value: updated.value,
      },
    });

    return success({
      config: mapToEntry(updated),
    });
  } catch (error) {
    return databaseFailure('updateRuntimeConfig', error);
  }
};

// DECISION: per-key integer/min/max contract for 'number' knobs (the kernel registry only carries
// value_type). A bad value can be destructive: EVENT_LOG_MAX_AGE_DAYS = -1 or 0 moves the cleanup
// cutoff to now or the future and purges the audit table, EVENT_LOG_MAX_RECORDS = 0 deletes every
// row, so both are min:1 (a retention boundary, never an "unlimited" switch; cleanupOldEventLogs_IO
// also guards <= 0). Other numeric knobs are non-negative integers. Unlisted keys get only the generic
// finite-number check.
type NumericConstraint = {
  integer: boolean;
  min: number;
  max?: number;
};

const NUMERIC_CONFIG_CONSTRAINTS: Record<string, NumericConstraint> = {
  // DECISION: the pairing token TTL is in MINUTES and capped at 60; the QR token is short-lived on
  // purpose, so an admin cannot stretch it to an unsafe lifetime.
  PAIRING_SESSION_TTL_MINUTES: { integer: true, min: 1, max: 60 },
  EVENT_LOG_MAX_AGE_DAYS: { integer: true, min: 1 },
  EVENT_LOG_MAX_RECORDS: { integer: true, min: 1 },
  STRIPE_EVENT_JANITOR_STALE_MINUTES: { integer: true, min: 0 },
  STRIPE_EVENT_JANITOR_MAX_RETRIES: { integer: true, min: 0 },
  STRIPE_EVENT_JANITOR_BATCH_SIZE: { integer: true, min: 1 },
};

// Canonical decimal numeric string: optional sign, integer part, optional fraction.
// Deliberately rejects the permissive coercions Number() would otherwise accept:
// radix prefixes (0x/0b/0o), scientific notation (1e308), Infinity, and
// surrounding/internal whitespace. Single source of truth for "is this a plain number".
const DECIMAL_NUMERIC_RE = /^-?\d+(\.\d+)?$/;

/**
 * Validate a numeric runtime-config value: strict finite plain-decimal contract,
 * plus optional per-key integer/range constraints. Returns an error message or null.
 */
const validateNumericConfig = (key: string, value: string): string | null => {
  if (!DECIMAL_NUMERIC_RE.test(value)) {
    return 'Value must be a plain finite number (no Infinity, hex/binary prefix, scientific notation, or whitespace)';
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 'Value must be a finite number';
  }

  const constraint = NUMERIC_CONFIG_CONSTRAINTS[key];
  if (constraint === undefined) {
    return null;
  }
  if (constraint.integer && !Number.isInteger(parsed)) {
    return 'Value must be an integer';
  }
  if (parsed < constraint.min) {
    return `Value must be >= ${constraint.min}`;
  }
  if (constraint.max !== undefined && parsed > constraint.max) {
    return `Value must be <= ${constraint.max}`;
  }
  return null;
};

/** Validate value against its declared type */
const validateValueType = (
  key: string,
  value: string,
  valueType: RuntimeConfigValueType
): string | null => {
  if (key === 'FREE_EMAIL_MODE' && !['OFF', 'PREVIEW', 'ON'].includes(value)) {
    return 'Dozwolone wartości: OFF, PREVIEW, ON';
  }
  switch (valueType) {
    case 'number': {
      return validateNumericConfig(key, value);
    }
    case 'boolean': {
      if (value !== 'true' && value !== 'false') {
        return 'Value must be "true" or "false"';
      }
      return null;
    }
    case 'json': {
      try {
        JSON.parse(value);
        return null;
      } catch {
        return 'Value must be valid JSON';
      }
    }
    case 'string':
      return null;
    default: {
      const _exhaustive: never = valueType;
      void _exhaustive;
      return null;
    }
  }
};

/**
 * Get a runtime config value (for use by other parts of the system).
 * Checks cache → DB → default.
 */
export const getRuntimeConfigValue = async (
  key: string,
  defaultValue: string
): Promise<string> => {
  // Check cache
  const cached = runtimeConfigCache.get(key);
  // DECISION: != null, not truthy. '' is a valid cached value (MAINTENANCE_MESSAGE='' = no banner,
  // the normal case on the hottest public key); a truthy check would hit the DB on every call.
  if (cached != null) {
    return cached;
  }

  try {
    const config = await DB_CLIENT.use.runtimeConfig.findUnique({
      where: { key },
      select: { value: true },
    });

    const value = config?.value ?? defaultValue;

    // Store in cache
    runtimeConfigCache.set(key, value);

    return value;
  } catch {
    return defaultValue;
  }
};

/**
 * Public (no-auth) runtime-config projection.
 *
 * DECISION: security allow-list of exactly three keys, each read per key through
 * getRuntimeConfigValue (never findMany over the table): MAINTENANCE_MESSAGE, MAINTENANCE_MODE and
 * VERBOSE_LOG_MODE. VERBOSE_LOG_MODE is public on purpose: a logged-out client must learn whether to
 * ship info-level logs from the same key the backend uses; it is a bare boolean, so it discloses
 * nothing (STRIPE_EVENT_JANITOR_*, EVENT_LOG_*, API_TIMING_DEBUG_MODE stay admin-only; docs/LOGGING.md).
 * The response shape makes the list structural. No admin check: readable by everyone, pre-login too.
 */
export const getPublicRuntimeConfig_IO = async (): Promise<
  OperationResult<
    ADMIN_DTO_API_V1['GET_RUNTIME_CONFIG_PUBLIC']['RESPONSE'],
    DatabaseError
  >
> => {
  const maintenanceMessage = await getRuntimeConfigValue(
    'MAINTENANCE_MESSAGE',
    ''
  );
  const maintenanceMode =
    (await getRuntimeConfigValue('MAINTENANCE_MODE', 'false')) === 'true';
  const verboseLogMode =
    (await getRuntimeConfigValue('VERBOSE_LOG_MODE', 'false')) === 'true';
  return success({ maintenanceMessage, maintenanceMode, verboseLogMode });
};
