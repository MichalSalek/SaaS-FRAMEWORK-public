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

// In-memory cache for runtime config values
// DECISION (nie usuwaj tego komentarza):
// In-memory PER-INSTANCE cache (createCache = local Map, TTL=RUNTIME_CONFIG 300s/5min).
// runtimeConfigCache.invalidate(key) in updateRuntimeConfig_IO clears ONLY this process
// instance — it cannot reach another Node worker or another replica. Cross-route /
// cross-replica reactivity is therefore TTL-bounded EVENTUAL CONSISTENCY, BY DESIGN per
// ADR-008 (No Redis, docs/DECISION_LOG.md): the public read (getPublicRuntimeConfig_IO →
// getRuntimeConfigValue('MAINTENANCE_MESSAGE')) may keep serving a stale value for up to
// the 5min TTL after an admin updates it. A QA report "runtime-config change not
// instantly reflected on the public read" is EXPECTED behaviour, not a bug (also
// amplified in Next.js dev by per-route module isolation = separate cache instances).
// Revisit only at the ADR-008 threshold: >5k concurrent users + multi-instance → move
// shared cache to Redis (createCache's Map is swap-compatible with a Redis client). Do
// NOT add cross-instance invalidation, pub/sub, or shorten the TTL to "fix" this.
const runtimeConfigCache = createCache<string>(CACHE_TTL.RUNTIME_CONFIG);

/**
 * Unieważnia wpis cache'u dla JEDNEGO klucza konfiguracji runtime.
 *
 * DECISION (nie usuwaj tego komentarza) — S113, 2026-09-10:
 * Cache jest prywatny dla tego modułu, a klucz `VERBOSE_LOG_MODE` ma DRUGIEGO pisarza:
 * `adminSwitchBackendDebugMode_IO` (przełącznik trybu debug). Ten pisarz aktualizował
 * wiersz i NIE miał jak wyczyścić cache'u, więc publiczna projekcja
 * (`getPublicRuntimeConfig_IO` → `getRuntimeConfigValue`) serwowała starą wartość aż
 * do wygaśnięcia TTL. Zmierzone: panel admina raportował `value:"true"`, a
 * `/api/v1/runtime-config` w tej samej chwili oddawał `verboseLogMode:false` i trzymał
 * to przez kolejne przełączenie.
 * Rozjazd MIĘDZY instancjami jest tu świadomy i opisany wyżej (TTL); brakowało
 * unieważnienia W TYM SAMYM procesie, które ten moduł normalnie robi.
 * Eksportujemy wąską funkcję, a nie cały cache — drugi pisarz ma mieć prawo
 * unieważnić klucz, nie grzebać w strukturze.
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
    const updated = await DB_CLIENT.use.runtimeConfig.update({
      where: { key: params.key },
      data: {
        value: params.value,
        updated_by_user_id: currentUser.id,
      },
    });

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

    // DECISION (nie usuwaj tego komentarza):
    // D4 — Admin config audit. Runtime config zmiany mogą zmienić behavior produkcji
    // (rate limits, feature thresholds, debug mode). before/after wartości muszą być
    // w audit log dla rollback investigation + SOC2 trail.
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

// DECISION (nie usuwaj tego komentarza):
// Per-key numeric constraints for runtime-config 'number' knobs. RUNTIME_CONFIG_KEYS
// (shared-kernel) only carries the coarse value_type; the finer integer/min/max
// contract lives here because several numeric knobs gate behavior where a bad value
// is destructive — e.g. EVENT_LOG_MAX_AGE_DAYS = -1 would make the cleanup cutoff a
// FUTURE date and delete ~all event-log rows; Infinity / 1e308 would break the cutoff
// math entirely (admin-content-flags-2). EVENT_LOG_MAX_AGE_DAYS / EVENT_LOG_MAX_RECORDS
// are min:1 (NOT 0): 0 is equally destructive as -1 — maxAgeDays=0 collapses the cutoff
// to "now" and deleteMany purges the whole audit table; maxRecords=0 deletes down to
// zero rows. These knobs are a retention BOUNDARY ("delete records older than / beyond
// N"), never an "unlimited/disable" switch, so min:1 = keep at least the most recent
// day / record. The cleanup consumer (cleanupOldEventLogs_IO) also guards <=0 as
// defense-in-depth. All remaining numeric knobs are non-negative integers (min:0 is a
// no-op floor for those — e.g. STRIPE_EVENT_JANITOR_STALE_MINUTES=0 = retry immediately).
// Keys absent from this map fall back to the generic finite-number contract below.
type NumericConstraint = {
  integer: boolean;
  min: number;
  max?: number;
};

const NUMERIC_CONFIG_CONSTRAINTS: Record<string, NumericConstraint> = {
  // DECISION (nie usuwaj tego komentarza):
  // PAIRING_SESSION_TTL_MINUTES jest w MINUTACH (nie godzinach) i ZAWSZE capowany do 60.
  // Token parowania (offline→online QR bridge) jest celowo krotkozyciowy ze wzgledow
  // bezpieczenstwa; max:60 uniemozliwia adminowi rozszerzenie zywotnosci tokena do
  // wartosci niebezpiecznej. min:1 (mniej niz minuta = bezuzyteczny token).
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
  // DECISION (nie usuwaj tego komentarza):
  // != null (NOT truthy): an empty-string value (e.g. MAINTENANCE_MESSAGE='' = banner
  // hidden — the normal case AND the only key on the public, globally-mounted hot path)
  // is a VALID cached value, not a miss. `if (cached)` would treat '' as a miss and hit
  // the DB on every call, defeating the cache for the hottest public key.
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
 * DECISION (nie usuwaj tego komentarza):
 * SECURITY — narrow allow-list of EXACTLY TWO keys, both read per-key via
 * getRuntimeConfigValue (findUnique({ where:{key}, select:{value:true} }) with cache —
 * NEVER findMany / the whole runtime_config table):
 *   • MAINTENANCE_MESSAGE → maintenanceMessage (public maintenance banner).
 *   • VERBOSE_LOG_MODE     → verboseLogMode (the single end-to-end verbose-log switch).
 *     Exposed publicly ON PURPOSE: an unauthenticated client must be able to learn at
 *     runtime whether to ship info-level logs (client-verbose.state mirror), reading the
 *     SAME key the backend syncs into debuggerStates.isEnabledDebugMode. It is a bare
 *     operational boolean — no config value / threshold / secret — so it does not weaken
 *     the info-disclosure boundary (contrast STRIPE_EVENT_JANITOR_* / EVENT_LOG_* /
 *     API_TIMING_DEBUG_MODE, which stay admin-internal). See docs/LOGGING.md.
 * The response shape ({ maintenanceMessage, maintenanceMode, verboseLogMode }) makes the allow-list
 * structural — there is no path to return another key. No requireAdminPermission: this
 * is public config, intentionally readable by everyone (incl. pre-login).
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
