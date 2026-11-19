import { z } from 'zod';
import { wireInstant } from '../../application/contracts/wire-values';
import {
  accountType,
  clientAccountSchema,
  eventLogType,
  freeRecord,
  logIssueDisplayStatus,
  logIssueStatus,
  safeSessionSchema,
  safeStylistSchema,
} from './admin-response-core.contract-schemas';

export const safeCurrentUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  image: z.string().nullable(),
  name: z.string(),
  role_id: z.string(),
  createdAt: wireInstant,
  updatedAt: wireInstant,
  is_active: z.boolean(),
  disabled_at: wireInstant.nullable(),
  deleted_at: wireInstant.nullable(),
  recovery_available: z.boolean(),
  account_type: accountType,
  notifications_enabled: z.boolean(),
  terms_accepted_at: wireInstant.nullable(),
  last_login_at: wireInstant.nullable(),
  moderation_strikes: z.number(),
  delete_confirm_version: z.number(),
  session: safeSessionSchema,
  stylist_account: safeStylistSchema.nullable(),
  client_account: clientAccountSchema.nullable(),
});

// ── Logs ─────────────────────────────────────────────────────────────────────

export const eventLogRecordSchema = z.object({
  id: z.string(),
  created_at: wireInstant,
  environment: z.string(),
  application: z.string(),
  namespace: z.string(),
  event_log_chain_id: z.string(),
  type: z.string(),
  message: z.string(),
  payload: z.string(),
  client_url: z.string(),
  user_id: z.string().nullable(),
  user_metadata: z.string(),
});

export const logsResponseSchema = z.object({
  records: z.array(eventLogRecordSchema),
  nextCursor: z.number().nullable(),
  totalCount: z.number(),
  oldestRecordDate: z.string().nullable(),
});

export const logIssueGroupSchema = z.object({
  fingerprint: z.string(),
  application: z.string(),
  type: z.string(),
  namespace: z.string(),
  sample_message: z.string(),
  sample_id: z.string(),
  count: z.number(),
  first_seen: wireInstant,
  last_seen: wireInstant,
  status: logIssueDisplayStatus,
  note: z.string().nullable(),
  status_updated_at: wireInstant.nullable(),
});

export const logGroupsResponseSchema = z.object({
  groups: z.array(logIssueGroupSchema),
  totalGroups: z.number(),
});

export const logIssueStatusResponseSchema = z.object({
  fingerprint: z.string(),
  status: logIssueStatus,
});

export const logDetailsGroupSchema = z.object({
  fingerprint: z.string(),
  status: logIssueDisplayStatus,
  note: z.string().nullable(),
  count: z.number(),
  first_seen: wireInstant,
  last_seen: wireInstant,
});

export const logDetailsResponseSchema = z.object({
  record: eventLogRecordSchema,
  chain: z.array(eventLogRecordSchema),
  group: logDetailsGroupSchema.nullable(),
  recent: z.array(eventLogRecordSchema),
});

export const auditTrailResponseSchema = z.object({
  entries: z.array(
    z.object({
      id: z.string(),
      created_at: wireInstant,
      event_name: z.string(),
      admin_user_id: z.string().nullable(),
      admin_email: z.string().nullable(),
      admin_name: z.string().nullable(),
      target_info: z.string().nullable(),
      details: z.string(),
      namespace: z.string(),
    })
  ),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});

export const userTimelineResponseSchema = z.object({
  entries: z.array(
    z.object({
      id: z.string(),
      created_at: wireInstant,
      event_name: z.string(),
      event_type: eventLogType,
      description_pl: z.string(),
      namespace: z.string(),
      details: freeRecord.nullable(),
    })
  ),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});

export const debugModeResponseSchema = z.object({
  event: z.enum([
    'DEBUG_MODE_ENABLED',
    'DEBUG_MODE_DISABLED',
    'DEBUG_DB_MODE_ENABLED',
    'DEBUG_DB_MODE_DISABLED',
  ]),
});

export const serverStampSchema = z.object({
  serverId: z.string(),
  timestamp: z.string(),
});

/**
 * Live wire of POST admin/check-access/url. `data` is the fetched body: JSON, or the
 * raw text when it does not parse. The DTO still says `{ serverId, timestamp }` (that
 * shape is ADMIN_CHECK_ACCESS_HEALTH).
 */
export const checkAccessUrlResponseSchema = z.object({
  status: z.number(),
  statusText: z.string(),
  headers: z.record(z.string(), z.string()),
  data: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(z.unknown()),
    freeRecord,
  ]),
});

// ── Health, attention, crawlers, mailing, moderation ─────────────────────────
