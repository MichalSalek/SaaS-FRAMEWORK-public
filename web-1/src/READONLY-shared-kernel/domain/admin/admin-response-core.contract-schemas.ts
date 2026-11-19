import { z } from 'zod';
import { wireInstant } from '../../application/contracts/wire-values';
import { ANNOUNCEMENT_TYPES } from './announcements.config';
import { announcementTranslationsSchema } from './announcement-content';
import { LOG_ISSUE_STATUSES, LOG_ISSUE_REGRESSED } from './log-triage.config';
import { AI_CRAWLER_BOT_CATEGORIES } from '../seo/ai-crawler-detection';
import { PricingPlanValue } from '../pricing/pricing.config';
import { MODERATION_ACTIONS } from '../../models/moderation/moderation.dto';
import {
  AccountStatusValue,
  AccountTypeValue,
  ContentReportReasonValue,
  ContentReportStatusValue,
  EventLogTypeValue,
  PaymentStatusValue,
  SubscriptionStatusValue,
} from '../../models/db_models.generated.dto';

/** A 2xx whose `data` key is omitted (`respondSuccess(res, undefined, …)`). */
export const noDataSchema = z.undefined();

export const successFlagSchema = z.object({
  success: z.boolean(),
});

export const pricingPlan = z.enum(PricingPlanValue);
export const accountType = z.enum(AccountTypeValue);
export const accountStatus = z.enum(AccountStatusValue);
export const paymentStatus = z.enum(PaymentStatusValue);
export const subscriptionStatus = z.enum(SubscriptionStatusValue);
export const announcementType = z.enum(ANNOUNCEMENT_TYPES);
export const eventLogType = z.enum(EventLogTypeValue);
export const reportReason = z.enum(ContentReportReasonValue);
export const reportStatus = z.enum(ContentReportStatusValue);
export const moderationAction = z.enum(MODERATION_ACTIONS);
export const botCategory = z.enum(AI_CRAWLER_BOT_CATEGORIES);
export const logIssueStatus = z.enum(LOG_ISSUE_STATUSES);
export const logIssueDisplayStatus = z.enum([
  ...LOG_ISSUE_STATUSES,
  LOG_ISSUE_REGRESSED,
]);
export const valueType = z.enum(['string', 'number', 'boolean', 'json']);

export const freeRecord = z.record(z.string(), z.unknown());

// ── Notes, policies, flags, config, announcements ────────────────────────────

export const notesResponseSchema = z.object({
  notes: z.string(),
  versions: z.array(
    z.object({
      id: z.string(),
      created_at: wireInstant,
      length: z.string(),
    })
  ),
});

export const noteIdSchema = z.object({ note_id: z.string() });

export const policySchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  is_main: z.boolean(),
  created_at: wireInstant,
  updated_at: wireInstant,
});

export const policiesResponseSchema = z.object({
  policies: z.array(policySchema),
});

export const policyIdSchema = z.object({ policy_id: z.string() });

export const featureFlagSchema = z.object({
  id: z.string(),
  key: z.string(),
  description: z.string().nullable(),
  is_enabled: z.boolean(),
  expires_at: wireInstant.nullable(),
  updated_at: wireInstant,
});

export const featureFlagListSchema = z.array(featureFlagSchema);

export const publicFeatureFlagsSchema = z.record(z.string(), z.boolean());

export const runtimeConfigEntrySchema = z.object({
  id: z.string(),
  key: z.string(),
  value: z.string(),
  value_type: valueType,
  description: z.string().nullable(),
  is_predefined: z.boolean(),
  updated_at: wireInstant,
});

export const configsResponseSchema = z.object({
  configs: z.array(runtimeConfigEntrySchema),
});

export const configUpdatedSchema = z.object({
  config: runtimeConfigEntrySchema,
});

export const announcementSchema = z.object({
  id: z.string(),
  title: z.string(),
  message: z.string(),
  type: announcementType,
  is_active: z.boolean(),
  starts_at: wireInstant.nullable(),
  ends_at: wireInstant.nullable(),
  created_by_user_id: z.string().nullable(),
  created_at: wireInstant,
  translations: announcementTranslationsSchema,
  audience_anonymous: z.boolean(),
  audience_client: z.boolean(),
  audience_stylist: z.boolean(),
  notification_sent_at: wireInstant.nullable(),
});

export const announcementListSchema = z.array(announcementSchema);
export const announcementIdSchema = z.object({ id: z.string() });

// ── Colors, traits, permissions ──────────────────────────────────────────────

export const colorIdSchema = z.object({ color_id: z.string() });
export const traitIdSchema = z.object({ trait_id: z.string() });

const permissionRefSchema = z.object({
  id: z.string(),
  event_name: z.string(),
  category: z.string(),
});

export const permissionsResponseSchema = z.object({
  roles: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      is_system: z.boolean(),
      permissions: z.array(
        z.object({
          permission_id: z.string(),
          permission: permissionRefSchema,
        })
      ),
    })
  ),
  allPermissions: z.array(
    permissionRefSchema.extend({
      description: z.string().nullable(),
      is_system: z.boolean(),
    })
  ),
});

// ── Users list, metrics, bulk, impersonation ─────────────────────────────────

const userListStylistSchema = z.object({
  pricing_plan: pricingPlan,
  payment_status: paymentStatus,
  account_status: accountStatus,
  trial_started_at: wireInstant.nullable(),
  trial_ends_at: wireInstant.nullable(),
});

const userListStatsSchema = z.object({
  photos: z.number().nullable(),
  public_works: z.number().nullable(),
  connections: z.number(),
  inspiration_sessions: z.number(),
  messages_sent: z.number(),
  support_threads: z.number(),
  push_devices: z.number(),
  city: z.string().nullable(),
  team_role: z.enum(['OWNER', 'MEMBER']).nullable(),
  notifications_enabled: z.boolean(),
  email_marketing: z.boolean().nullable(),
});

export const usersPageSchema = z.object({
  records: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
      emailVerified: z.boolean(),
      name: z.string(),
      account_type: accountType,
      role_id: z.string(),
      is_active: z.boolean(),
      createdAt: wireInstant,
      updatedAt: wireInstant,
      last_login_at: wireInstant.nullable(),
      stats: userListStatsSchema,
      stylist_account: userListStylistSchema.nullable(),
      onboarding_completed: z.boolean(),
      _count: z.object({ sessions: z.number() }),
    })
  ),
  nextCursor: z.string().nullable(),
});

const metricChangeSchema = z.object({
  current: z.number(),
  previous: z.number(),
  change_percent: z.number().nullable(),
});

export const reportsResponseSchema = z.object({
  period: z.enum(['week', 'month', 'quarter']),
  period_start: z.string(),
  period_end: z.string(),
  funnel: z.object({
    total_registrations: metricChangeSchema,
    active_accounts: metricChangeSchema,
    paid_accounts: metricChangeSchema,
    conversion_to_active_percent: z.number(),
    conversion_to_paid_percent: z.number(),
  }),
  retention: z.object({
    active_7d: z.number(),
    active_30d: z.number(),
    total_users: z.number(),
    retention_7d_percent: z.number(),
    retention_30d_percent: z.number(),
  }),
  revenue: z.object({
    users_free: z.number(),
    users_pro: z.number(),
    users_pro_plus: z.number(),
    users_studio: z.number(),
    users_scale: z.number(),
  }),
  growth: z.object({
    new_users_per_day: z.array(
      z.object({ date: z.string(), count: z.number() })
    ),
  }),
  top_stylists: z.array(
    z.object({
      account_id: z.string(),
      display_name: z.string().nullable(),
      gallery_record_count: z.number(),
      pricing_plan: pricingPlan,
    })
  ),
  churn: z.object({
    disabled_in_period: metricChangeSchema,
    deleted_in_period: metricChangeSchema,
  }),
  cached_at: z.string(),
});

export const metricsResponseSchema = z.object({
  users: z.object({
    total: z.number(),
    active: z.number(),
    disabled: z.number(),
    newToday: z.number(),
    newThisWeek: z.number(),
    newThisMonth: z.number(),
    byRole: z.array(
      z.object({
        role_id: z.string(),
        role_name: z.string(),
        count: z.number(),
      })
    ),
    byPlan: z.array(z.object({ plan: pricingPlan, count: z.number() })),
    byAccountType: z.array(z.object({ type: accountType, count: z.number() })),
  }),
  sessions: z.object({ activeSessions: z.number() }),
  gallery: z.object({ totalRecords: z.number() }),
  recentRegistrations: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
      name: z.string(),
      created_at: wireInstant,
      role_id: z.string(),
    })
  ),
  conversion_funnel: z.object({
    signup_count: z.number(),
    trial_started_count: z.number(),
    trial_to_paid_count: z.number(),
    trial_expired_count: z.number(),
    paid_active_count: z.number(),
    conversion_rate_pct: z.number(),
    churn_rate_30d_pct: z.number(),
  }),
});

export const bulkActionSchema = z.object({
  affected: z.number(),
  skipped: z.number(),
  errors: z.array(z.object({ user_id: z.string(), reason: z.string() })),
});

export const bulkLogoutSchema = z.object({
  affected: z.number(),
  sessionsDeleted: z.number(),
});

export const refreshImpersonationSchema = z.object({
  expiresAt: z.number(),
});

export const emailPreferencesSchema = z.object({
  trial_sequence: z.boolean(),
  marketing: z.boolean(),
});

export const salonPlanSchema = z.object({
  salon_account_id: z.string(),
  salon_name: z.string(),
  pricing_plan: pricingPlan,
});

export const safeStylistSchema = z.object({
  account_id: z.string(),
  display_name: z.string().nullable(),
  business_name: z.string().nullable(),
  address_street: z.string().nullable(),
  address_city: z.string().nullable(),
  address_postal_code: z.string().nullable(),
  address_country: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  description: z.string().nullable(),
  vanity_url: z.string().nullable(),
  instagram_handle: z.string().nullable(),
  avatar_url: z.string().nullable(),
  brand_accent_color: z.string().nullable(),
  view_count: z.number(),
  pricing_plan: pricingPlan,
  payment_status: paymentStatus,
  account_status: accountStatus,
  plan_selected_at: wireInstant.nullable(),
  subscription_status: subscriptionStatus.nullable(),
  cancel_at_period_end: z.boolean().nullable(),
  cancel_at: wireInstant.nullable(),
  current_period_end: wireInstant.nullable(),
  trial_started_at: wireInstant.nullable(),
  trial_ends_at: wireInstant.nullable(),
  admin_plan_override: z.boolean(),
  email_preferences: emailPreferencesSchema.nullable(),
  effective_pricing_plan: pricingPlan.optional(),
  salon_plan: salonPlanSchema.nullable().optional(),
  billing: z
    .object({
      nextChargeAmount: z.number().nullable(),
      currency: z.string().nullable(),
      nextChargeAt: z.string().nullable(),
      billingPeriod: z.enum(['monthly', 'yearly']).nullable(),
    })
    .nullable()
    .optional(),
  has_salon_profile: z.boolean().optional(),
  salon_display_name: z.string().optional(),
});

export const safeSessionSchema = z.object({
  id: z.string(),
  expires: wireInstant,
  ip_address: z.string().nullable(),
  user_agent: z.string().nullable(),
  device_type: z.string().nullable(),
  createdAt: wireInstant,
  updatedAt: wireInstant,
});

export const clientAccountSchema = z.object({
  client_account_id: z.string(),
  created_by_user_id: z.string(),
  contact_phone: z.string().nullable(),
  contact_email: z.string().nullable(),
  dashboard_note: z.string().nullable(),
  created_at: wireInstant,
});

/** SafeCurrentUser: the profile become-user and switch-back return (no session token). */
