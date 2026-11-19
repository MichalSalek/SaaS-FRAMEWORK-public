import { EVENTS } from '../domain/commands-and-queries/cqrs.config';
import type { EVENT_INFO_TYPE } from '../domain/commands-and-queries/cqrs.types';
import type { NailLength } from '../domain/gallery/nail-length.config';
import { NAIL_LENGTHS } from '../domain/gallery/nail-length.config';
import type { LocaleType } from '../domain/i18n/i18n.config';
import { I18N_CONFIG } from '../domain/i18n/i18n.config';
import type { PricingPlan } from '../domain/pricing/pricing.config';
import { PricingPlanValue } from '../domain/pricing/pricing.config';
import { ANNOUNCEMENT_TYPES } from '../domain/admin/announcements.config';
import { TRAIT_CATEGORIES } from '../domain/admin/traits.config';
import {
  AI_CRAWLER_BOT_CATEGORIES,
  type AiCrawlerBotCategory,
} from '../domain/seo/ai-crawler-detection';
import type { RuntimeConfigValueType } from '../domain/admin/runtime-config.config';
import type { AnnouncementType } from './admin/admin.dto';
import {
  SupportThreadStatusValue,
  SupportSenderTypeValue,
} from './support/support.dto';
import type {
  SupportThreadStatus,
  SupportSenderType,
} from './support/support.dto';
import type { UserActivityLogRecord } from './event-log/event_log.dto';
import type {
  AccountStatus,
  AccountType,
  EventLog,
  EventLogType,
  PaymentStatus,
  SubscriptionStatus,
  StylistAccount,
  User,
} from './db_models.generated.dto';
import {
  AccountStatusValue,
  AccountTypeValue,
  EventLogTypeValue,
  PaymentStatusValue,
  SubscriptionStatusValue,
} from './db_models.generated.dto';
import type {
  Role,
  SessionMode,
  SystemRoleIdType,
  TraitCategory,
  UserMetadata,
} from './db_models.manual.dto';
import {
  RoleValue,
  SessionModeValue,
  SystemRoleId,
} from './db_models.manual.dto';

/**
 * Type Narrowers for generic database Ints to Domain Unions
 */

export const isRoleNarrower = (maybe: unknown): maybe is Role => {
  return (
    typeof maybe === 'string' &&
    Object.values(RoleValue).includes(maybe as Role)
  );
};

// SSOT: derive the accepted set from SystemRoleId values (db_models.manual.dto)
// so a new system role cannot silently drift from a hand-mirrored literal.
// Used to narrow Prisma's raw `role_id: string` back to SystemRoleIdType when a
// projection selects the column (e.g. adminGetUsersPaginated) instead of laundering
// via `as unknown as`.
export const isSystemRoleIdNarrower = (
  maybe: unknown
): maybe is SystemRoleIdType => {
  return (
    typeof maybe === 'string' &&
    (Object.values(SystemRoleId) as readonly string[]).includes(maybe)
  );
};

export const isPricingPlanNarrower = (maybe: unknown): maybe is PricingPlan => {
  return (
    typeof maybe === 'string' &&
    Object.values(PricingPlanValue).includes(maybe as PricingPlan)
  );
};

export const isPaymentStatusNarrower = (
  maybe: unknown
): maybe is PaymentStatus => {
  return (
    typeof maybe === 'string' &&
    Object.values(PaymentStatusValue).includes(maybe as PaymentStatus)
  );
};

export const isAccountStatusNarrower = (
  maybe: unknown
): maybe is AccountStatus => {
  return (
    typeof maybe === 'string' &&
    Object.values(AccountStatusValue).includes(maybe as AccountStatus)
  );
};

export const isAccountTypeNarrower = (maybe: unknown): maybe is AccountType => {
  return (
    typeof maybe === 'string' &&
    Object.values(AccountTypeValue).includes(maybe as AccountType)
  );
};

export const isSubscriptionStatusNarrower = (
  maybe: unknown
): maybe is SubscriptionStatus => {
  return (
    typeof maybe === 'string' &&
    Object.values(SubscriptionStatusValue).includes(maybe as SubscriptionStatus)
  );
};

export const isEventLogTypeNarrower = (
  maybe: unknown
): maybe is EventLogType => {
  return (
    typeof maybe === 'string' &&
    Object.values(EventLogTypeValue).includes(maybe as EventLogType)
  );
};

export const isSessionModeNarrower = (maybe: unknown): maybe is SessionMode => {
  return (
    typeof maybe === 'string' &&
    Object.values(SessionModeValue).includes(maybe as SessionMode)
  );
};

// DECISION: the Set is built ONCE at module load, not per call. `isEventInfoNarrower` runs in loops
// (the trial-mail sweep passes up to 10 000 log rows per run, the mail history list up to 100 per
// job); rebuilding `Object.values(EVENTS.INFO).flat()` (a fresh 338-string array) plus a linear
// `.includes` each call cost 43 ms per 10k calls vs 0.2 ms. Same name set, same `typeof === 'string'`
// gate. Twin hoisted pattern: `INFO_EVENTS_SET` in policies/events.policy.ts, keep the two in step.
// EVENTS is frozen and static, so the load-time snapshot cannot drift.
const INFO_EVENT_NAMES: ReadonlySet<string> = new Set(
  (Object.values(EVENTS.INFO) as unknown as readonly string[][]).flat()
);

export const isEventInfoNarrower = (
  maybe: unknown
): maybe is EVENT_INFO_TYPE => {
  return typeof maybe === 'string' && INFO_EVENT_NAMES.has(maybe);
};

export const isLocaleNarrower = (maybe: unknown): maybe is LocaleType => {
  return (
    typeof maybe === 'string' &&
    (I18N_CONFIG.locales as readonly string[]).includes(maybe)
  );
};

export const isNailLengthNarrower = (maybe: unknown): maybe is NailLength => {
  return (
    typeof maybe === 'string' &&
    Object.values(NAIL_LENGTHS).includes(maybe as NailLength)
  );
};

export const isAiCrawlerBotCategoryNarrower = (
  maybe: unknown
): maybe is AiCrawlerBotCategory => {
  return (
    typeof maybe === 'string' &&
    (AI_CRAWLER_BOT_CATEGORIES as readonly string[]).includes(maybe)
  );
};

/**
 * Narrow a DB string|null to AiCrawlerBotCategory with 'unknown' fallback.
 * Use instead of `value as AiCrawlerBotCategory` unsafe casts.
 */
export const narrowAiCrawlerBotCategory = (
  value: string | null | undefined
): AiCrawlerBotCategory =>
  isAiCrawlerBotCategoryNarrower(value) ? value : 'unknown';

// SSOT: derive from the runtime TRAIT_CATEGORIES (admin/traits.config) instead of a
// hand-mirrored literal — a new category added there cannot silently drift from here.
const TRAIT_CATEGORY_VALUES: readonly TraitCategory[] = TRAIT_CATEGORIES;

export const isTraitCategoryNarrower = (
  maybe: unknown
): maybe is TraitCategory => {
  return (
    typeof maybe === 'string' &&
    (TRAIT_CATEGORY_VALUES as readonly string[]).includes(maybe)
  );
};

export const isAnnouncementTypeNarrower = (
  maybe: unknown
): maybe is AnnouncementType => {
  return (
    typeof maybe === 'string' &&
    (ANNOUNCEMENT_TYPES as readonly string[]).includes(maybe)
  );
};

const RUNTIME_CONFIG_VALUE_TYPES: readonly RuntimeConfigValueType[] = [
  'string',
  'number',
  'boolean',
  'json',
];

export const isRuntimeConfigValueTypeNarrower = (
  maybe: unknown
): maybe is RuntimeConfigValueType => {
  return (
    typeof maybe === 'string' &&
    (RUNTIME_CONFIG_VALUE_TYPES as readonly string[]).includes(maybe)
  );
};

export const isSupportThreadStatusNarrower = (
  maybe: unknown
): maybe is SupportThreadStatus => {
  return (
    typeof maybe === 'string' &&
    (Object.values(SupportThreadStatusValue) as readonly string[]).includes(
      maybe
    )
  );
};

export const isSupportSenderTypeNarrower = (
  maybe: unknown
): maybe is SupportSenderType => {
  return (
    typeof maybe === 'string' &&
    (Object.values(SupportSenderTypeValue) as readonly string[]).includes(maybe)
  );
};

/**
 * Forced Assertion with Runtime Check
 */
export function assertType<T>(
  value: unknown,
  narrower: (v: unknown) => v is T,
  context: string
): T {
  if (narrower(value)) {
    return value;
  }
  throw new Error(`Type assertion failed for ${context}: received ${value}`);
}

/**
 * High-level Narrowers for Prisma-to-Domain mapping
 */

export function narrowStylistAccount(
  raw: unknown,
  context: string
): StylistAccount | null {
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  const data = raw as Record<string, unknown>;
  return {
    ...data,
    pricing_plan: assertType(
      data.pricing_plan as unknown,
      isPricingPlanNarrower,
      `pricing_plan in ${context}`
    ),
    payment_status: assertType(
      data.payment_status as unknown,
      isPaymentStatusNarrower,
      `payment_status in ${context}`
    ),
    account_status: assertType(
      data.account_status as unknown,
      isAccountStatusNarrower,
      `account_status in ${context}`
    ),
    subscription_status:
      data.subscription_status != null
        ? assertType(
            data.subscription_status as unknown,
            isSubscriptionStatusNarrower,
            `subscription_status in ${context}`
          )
        : null,
  } as StylistAccount;
}

export function narrowUser<T extends User>(
  raw: unknown,
  context: string
): T | null {
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  const data = raw as Record<string, unknown>;
  const narrowed: Record<string, unknown> = {
    ...data,
    // role_id is now a number, no narrowing needed
  };

  const hasStylistAccount = Boolean(data.stylist_account);
  if (hasStylistAccount) {
    narrowed.stylist_account = narrowStylistAccount(
      data.stylist_account,
      context
    );
  }

  return narrowed as unknown as T;
}

export function narrowUserMetadata(
  raw: unknown,
  _context: string
): UserMetadata {
  const data = raw as Record<string, unknown>;
  return {
    client_ip: typeof data?.client_ip === 'string' ? data.client_ip : null,
    location: typeof data?.location === 'string' ? data.location : null,
    language: typeof data?.language === 'string' ? data.language : null,
    user_agent: typeof data?.user_agent === 'string' ? data.user_agent : null,
  };
}

// DECISION: narrowEventLog handles the FULL EventLog row (write path: `writeRawEventLog_IO` ->
// `eventLog.create` returns every column), so spread plus event_type assert is honest. For the
// user-side 4-field "Aktywność" projection use `narrowUserActivityLogRecord`, not this one: spreading
// absent fields would lie about the contract.
export function narrowEventLog(raw: unknown, context: string): EventLog | null {
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  const data = raw as Record<string, unknown>;
  return {
    ...data,
    event_type: assertType(
      data.event_type as unknown,
      isEventLogTypeNarrower,
      `event_type in ${context}`
    ),
  } as unknown as EventLog;
}

// DECISION: honest narrower of the 4-field user-side "Aktywność" projection (PII minimisation, see
// UserActivityLogRecord in event-log/event_log.dto). It builds exactly the fields the SELECT in
// getEventLogsByUser_IO sends, no `as unknown as`, no phantom fields; event_type is validated at
// runtime.
export function narrowUserActivityLogRecord(
  raw: unknown,
  context: string
): UserActivityLogRecord | null {
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  const data = raw as Record<string, unknown>;
  return {
    event_log_id: data.event_log_id as UserActivityLogRecord['event_log_id'],
    event: data.event as UserActivityLogRecord['event'],
    event_type: assertType(
      data.event_type as unknown,
      isEventLogTypeNarrower,
      `event_type in ${context}`
    ),
    created_at: data.created_at as UserActivityLogRecord['created_at'],
  };
}

/**
 * Sort/Query Parameter Narrowers
 */

const SORT_ORDER_VALUES = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDER_VALUES)[number];

export const isSortOrderNarrower = (maybe: unknown): maybe is SortOrder => {
  return (
    typeof maybe === 'string' &&
    (SORT_ORDER_VALUES as readonly string[]).includes(maybe)
  );
};

// `last_login_at` and `city` sort nulls last; `photos` sorts by the stylist
// account's GalleryRecord count. Every key keeps the `id` tiebreaker in the
// resolver, so cursor pagination stays stable (admin-user-search.operations.ts).
export const ADMIN_USERS_SORT_BY_VALUES = [
  'id',
  'email',
  'name',
  'created_at',
  'last_login_at',
  'photos',
  'city',
] as const;
export type AdminUsersSortByField = (typeof ADMIN_USERS_SORT_BY_VALUES)[number];

export const isAdminUsersSortByFieldNarrower = (
  maybe: unknown
): maybe is AdminUsersSortByField => {
  return (
    typeof maybe === 'string' &&
    (ADMIN_USERS_SORT_BY_VALUES as readonly string[]).includes(maybe)
  );
};

/**
 * Error Handling Narrowers
 */
export const hasCode = (error: unknown): error is { code: string } => {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as Record<string, unknown>).code === 'string'
  );
};

export const hasEvent = (error: unknown): error is { event: string } => {
  return (
    typeof error === 'object' &&
    error !== null &&
    'event' in error &&
    typeof (error as Record<string, unknown>).event === 'string'
  );
};
