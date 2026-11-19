import { z } from 'zod';
import { wireInstant } from '../../application/contracts/wire-values';
import {
  reportReason,
  reportStatus,
  moderationAction,
  botCategory,
  freeRecord,
} from './admin-response-core.contract-schemas';

const serviceStatus = z.enum(['healthy', 'degraded', 'down']);
const serviceCheckSchema = z.object({
  name: z.string(),
  status: serviceStatus,
  latency_ms: z.number().nullable(),
  message: z.string().nullable(),
});

export const healthResponseSchema = z.object({
  backend: z.object({
    uptime_seconds: z.number(),
    memory_usage_mb: z.number(),
    memory_total_mb: z.number(),
    node_version: z.string(),
    environment: z.string(),
  }),
  database: serviceCheckSchema.extend({
    p95_query_latency_ms: z.number().nullable(),
  }),
  event_log_db: serviceCheckSchema,
  external_services: z.array(serviceCheckSchema),
  cloudinary_egress: z.object({
    egress_used_gb: z.number().nullable(),
    egress_limit_gb: z.number().nullable(),
    egress_pct: z.number().nullable(),
    egress_status: z.enum(['ok', 'warning', 'critical', 'unknown']),
    fetched_at: wireInstant.nullable(),
    message: z.string().nullable(),
  }),
  performance: z.object({
    avg_response_time_ms: z.number(),
    total_requests_tracked: z.number(),
  }),
  errors: z.object({
    count_last_hour: z.number(),
    recent: z.array(
      z.object({
        event_log_id: z.string(),
        event: z.string(),
        created_at: wireInstant,
        event_payload: freeRecord.nullable(),
      })
    ),
  }),
  log_aggregates: z.object({
    window_hours: z.number(),
    by_namespace_type: z.array(
      z.object({
        namespace: z.string(),
        type: z.string(),
        count: z.number(),
      })
    ),
    email_dead_lettered_last_hour: z.number(),
    stripe_dead_lettered_last_hour: z.number(),
  }),
  email_stats: z.object({
    sent_today: z.number(),
    sent_this_week: z.number(),
    failed_today: z.number(),
    dead_letter_unresolved: z.number(),
    dead_letter_oldest_at: wireInstant.nullable(),
  }),
  email_deliverability: z.object({
    bounce_rate_pct: z.number().nullable(),
    circuit_state: z.enum(['CLOSED', 'WARNING', 'OPEN']),
    last_check_at: wireInstant.nullable(),
    message: z.string().nullable(),
    daily_limit: z.object({
      limited: z.boolean(),
      reset_at: wireInstant.nullable(),
    }),
  }),
  payments: z.object({
    pending_disputes_count: z.number(),
    last_dispute_at: wireInstant.nullable(),
  }),
  alert_history: z.array(
    z.object({
      id: z.string(),
      event: z.string(),
      created_at: wireInstant,
      payload: freeRecord.nullable(),
    })
  ),
  sweeps: z.array(
    z.object({
      name: z.string(),
      status: z.enum(['ok', 'stale', 'never_run']),
      last_run_at: wireInstant.nullable(),
      last_duration_ms: z.number().nullable(),
      last_error: z.string().nullable(),
      stale_threshold_hours: z.number(),
    })
  ),
  checked_at: wireInstant,
});

export const attentionCountsSchema = z.object({
  support_awaiting_reply: z.number(),
  moderation_pending: z.number(),
  system_health_issues: z.number(),
  log_issues_open: z.number(),
  payments_attention: z.number(),
  stuck_accounts: z.number(),
  email_sweep_issues: z.number(),
});

const crawlerEventSchema = z.object({
  id: z.string(),
  created_at: wireInstant,
  user_agent: z.string(),
  path: z.string(),
  bot_name: z.string().nullable(),
  country: z.string().nullable(),
  bot_category: botCategory.nullable(),
});

export const crawlerStatsSchema = z.object({
  total_crawls: z.number(),
  unique_bots: z.number(),
  crawls_by_bot: z
    .array(
      z.object({
        bot_name: z.string(),
        bot_category: botCategory,
        count: z.number(),
      })
    )
    .readonly(),
  crawls_by_day: z
    .array(
      z.object({
        date: z.string(),
        count: z.number(),
        top_bot: z.string().nullable(),
      })
    )
    .readonly(),
  crawls_by_path: z
    .array(z.object({ path: z.string(), count: z.number() }))
    .readonly(),
  crawls_by_category: z
    .array(z.object({ bot_category: botCategory, count: z.number() }))
    .readonly(),
  recent_crawls: z.array(crawlerEventSchema).readonly(),
});

export const crawlerListSchema = z.object({
  items: z.array(crawlerEventSchema).readonly(),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
});

export const emailPreviewSchema = z.object({
  from: z.string(),
  replyTo: z.string(),
  preheader: z.string(),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
});

export const emailPipelineSchema = z.object({
  free: z.object({
    mode: z.enum(['OFF', 'PREVIEW', 'ON']),
    startedAt: wireInstant.nullable(),
    initializedAt: wireInstant.nullable(),
    enrolled: z.number(),
    candidates: z.array(
      z.object({
        enrollmentId: z.string(),
        userId: z.string(),
        email: z.string(),
        cohort: z.string(),
        plannedAt: wireInstant.nullable(),
        templateId: z.string().nullable(),
        decision: z.enum(['send', 'skip', 'finish']),
        reason: z.string(),
      })
    ),
  }),
  lifecycle: z.object({
    since: z.string(),
    accepted: z.number(),
    delivered: z.number(),
    delayed: z.number(),
    bounced: z.number(),
    complained: z.number(),
    unknown: z.number(),
    rejected: z.number(),
    suppressed: z.number(),
    history: z.array(
      z.object({
        id: z.string(),
        ruleId: z.string(),
        family: z.string(),
        cohort: z.string(),
        locale: z.string(),
        provider: z.string().nullable(),
        status: z.string(),
        deliveryStatus: z.string().nullable(),
        plannedAt: wireInstant,
        acceptedAt: wireInstant.nullable(),
        reason: z.string().nullable(),
      })
    ),
  }),
  lastSweepAt: wireInstant.nullable(),
  lastSweepEmailsSent: z.number().nullable(),
  sweepsLast7Days: z.number(),
  queue: z.array(
    z.object({
      userId: z.string(),
      email: z.string(),
      ruleId: z.string(),
      infoEvent: z.string(),
      templateId: z.string(),
      due: z.enum(['today', 'tomorrow']),
    })
  ),
  offers: z
    .object({
      issued: z.number(),
      redeemed: z.number(),
      active: z.number(),
    })
    .nullable(),
});

export const resolveReportResponseSchema = z.object({
  report_id: z.string(),
  status: reportStatus,
  action: moderationAction,
});

export const applyStrikeResponseSchema = z.object({
  user_id: z.string(),
  moderation_strikes: z.number(),
  ban_recommended: z.boolean(),
});

export const contentReportsResponseSchema = z.object({
  reports: z.array(
    z.object({
      id: z.string(),
      gallery_record_id: z.string().nullable(),
      reporter_id: z.string(),
      reason: reportReason,
      description: z.string().nullable(),
      status: reportStatus,
      admin_note: z.string().nullable(),
      created_at: wireInstant,
      resolved_at: wireInstant.nullable(),
      gallery_record: z
        .object({
          asset_url: z.string(),
          created_by_account_id: z.string(),
          gallery_record_owner_user_id: z.string().nullable(),
          owner_active_strikes: z.number(),
        })
        .nullable(),
      reporter: z
        .object({
          email: z.string(),
          name: z.string(),
        })
        .nullable(),
    })
  ),
  total_count: z.number(),
});
