// AUTO-GENERATED FROM PRISMA SCHEMA — DO NOT EDIT MANUALLY
// Source: web-1/src/prisma/schema.prisma
// Regenerate: npm run system:generate-dto
//
// This file contains types that map 1:1 to Prisma models and enums.
// Manual/business types are in db_models.manual.dto.ts

import type {IDType, IDStringType, DateAndTime} from '../application/application.types'
import type {ValueOf} from '../application/application.utils'
import type {PricingPlan} from '../domain/pricing/pricing.config'
import type {DateMetadata, DateMetadataWithUpdate, TraitCategory, SystemRoleIdType} from './db_models.manual.dto'
import type {EmailPreferences} from './email/email.dto'
import type {EVENTS_ALL_TYPE, EVENT_COMMANDS_AND_QUERIES_TYPE, GROUP_KEY} from '../domain/commands-and-queries/cqrs.types'
import type {AnnouncementType} from './admin/admin.dto'
import type {RuntimeConfigValueType} from '../domain/admin/runtime-config.config'
import type {DeletedUserBackup} from '../domain/recovery/deleted-user-backup.types'
import type {AiCrawlerBotCategory} from '../domain/seo/ai-crawler-detection'
import type {ContactAccessType} from '../domain/contact/contact-access.types'
import type {NewsletterConsentAction} from '../domain/newsletter/newsletter-consent.types'
import type {StaffPermission} from '../domain/user-and-account/staff_accounts.config'

// ============================================================
// ENUMS (from Prisma schema)
// ============================================================

export const EventLogTypeValue = Object.freeze({
  ACCOUNT: 'ACCOUNT',
  LOGIN: 'LOGIN',
  GALLERY: 'GALLERY',
  ADMIN: 'ADMIN',
  DOMAIN: 'DOMAIN',
  EMAIL: 'EMAIL'
} as const)
export type EventLogType = ValueOf<typeof EventLogTypeValue>

export const AccountTypeValue = Object.freeze({
  STYLIST: 'STYLIST',
  CLIENT: 'CLIENT'
} as const)
export type AccountType = ValueOf<typeof AccountTypeValue>

export const NailLengthValue = Object.freeze({
  SHORT: 'SHORT',
  MEDIUM: 'MEDIUM',
  LONG: 'LONG',
  XL: 'XL'
} as const)
export type NailLength = ValueOf<typeof NailLengthValue>

export const SubscriptionStatusValue = Object.freeze({
  ACTIVE: 'ACTIVE',
  CANCELED: 'CANCELED',
  INCOMPLETE: 'INCOMPLETE',
  INCOMPLETE_EXPIRED: 'INCOMPLETE_EXPIRED',
  PAST_DUE: 'PAST_DUE',
  TRIALING: 'TRIALING',
  UNPAID: 'UNPAID',
  PAUSED: 'PAUSED'
} as const)
export type SubscriptionStatus = ValueOf<typeof SubscriptionStatusValue>

export const PaymentStatusValue = Object.freeze({
  UNPAID: 'UNPAID',
  PAID: 'PAID',
  IN_PROGRESS: 'IN_PROGRESS',
  REJECTED: 'REJECTED'
} as const)
export type PaymentStatus = ValueOf<typeof PaymentStatusValue>

export const AccountStatusValue = Object.freeze({
  ACTIVE: 'ACTIVE',
  NOT_ACTIVE: 'NOT_ACTIVE',
  EXPIRING: 'EXPIRING',
  EXPIRED: 'EXPIRED'
} as const)
export type AccountStatus = ValueOf<typeof AccountStatusValue>

export const StaffRoleValue = Object.freeze({
  OWNER: 'OWNER',
  MANAGER: 'MANAGER',
  EMPLOYEE: 'EMPLOYEE'
} as const)
export type StaffRole = ValueOf<typeof StaffRoleValue>

export const PairingStatusValue = Object.freeze({
  ACTIVE: 'ACTIVE',
  REVOKED: 'REVOKED',
  CONTACT: 'CONTACT',
  PENDING: 'PENDING'
} as const)
export type PairingStatus = ValueOf<typeof PairingStatusValue>

export const StylistClientMessageSenderValue = Object.freeze({
  STYLIST: 'STYLIST',
  CLIENT: 'CLIENT'
} as const)
export type StylistClientMessageSender = ValueOf<typeof StylistClientMessageSenderValue>

export const SessionActivityKindValue = Object.freeze({
  TEXT: 'TEXT',
  SESSION_SUBMITTED: 'SESSION_SUBMITTED',
  SESSION_ACCEPTED: 'SESSION_ACCEPTED',
  SESSION_CHANGED: 'SESSION_CHANGED'
} as const)
export type SessionActivityKind = ValueOf<typeof SessionActivityKindValue>

export const SessionChangeScopeValue = Object.freeze({
  PHOTOS: 'PHOTOS',
  NOTE: 'NOTE',
  PHOTOS_AND_NOTE: 'PHOTOS_AND_NOTE'
} as const)
export type SessionChangeScope = ValueOf<typeof SessionChangeScopeValue>

export const VisitRecordSourceValue = Object.freeze({
  SESSION: 'SESSION',
  MANUAL: 'MANUAL'
} as const)
export type VisitRecordSource = ValueOf<typeof VisitRecordSourceValue>

export const ContentReportReasonValue = Object.freeze({
  INAPPROPRIATE: 'INAPPROPRIATE',
  FACE: 'FACE',
  SPAM: 'SPAM',
  OTHER: 'OTHER'
} as const)
export type ContentReportReason = ValueOf<typeof ContentReportReasonValue>

export const ContentReportStatusValue = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED'
} as const)
export type ContentReportStatus = ValueOf<typeof ContentReportStatusValue>

export const SessionContainerLifecycleStateValue = Object.freeze({
  DRAFT: 'DRAFT',
  READY: 'READY',
  SHARED: 'SHARED',
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  CLOSED: 'CLOSED'
} as const)
export type SessionContainerLifecycleState = ValueOf<typeof SessionContainerLifecycleStateValue>

export const SupportThreadStatusValue = Object.freeze({
  OPEN: 'OPEN',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED'
} as const)
export type SupportThreadStatus = ValueOf<typeof SupportThreadStatusValue>

export const SupportSenderTypeValue = Object.freeze({
  USER: 'USER',
  SUPPORT: 'SUPPORT'
} as const)
export type SupportSenderType = ValueOf<typeof SupportSenderTypeValue>

export const SupportThreadCategoryValue = Object.freeze({
  QUESTION: 'QUESTION',
  BILLING: 'BILLING',
  BUG: 'BUG',
  IDEA: 'IDEA',
  ACCOUNT: 'ACCOUNT',
  OTHER: 'OTHER'
} as const)
export type SupportThreadCategory = ValueOf<typeof SupportThreadCategoryValue>

export const NotificationTypeValue = Object.freeze({
  SYSTEM_ANNOUNCEMENT: 'SYSTEM_ANNOUNCEMENT',
  PAIR_REQUEST_RECEIVED: 'PAIR_REQUEST_RECEIVED',
  PAIR_REQUEST_ACCEPTED: 'PAIR_REQUEST_ACCEPTED',
  PAIR_CONNECTED_BY_QR: 'PAIR_CONNECTED_BY_QR',
  SESSION_SHARED: 'SESSION_SHARED',
  SESSION_CLOSED_BY_STYLIST: 'SESSION_CLOSED_BY_STYLIST',
  SESSION_EXPIRING_SOON: 'SESSION_EXPIRING_SOON',
  MESSAGE_RECEIVED: 'MESSAGE_RECEIVED',
  SALON_INVITATION_RECEIVED: 'SALON_INVITATION_RECEIVED',
  SALON_INVITATION_ACCEPTED: 'SALON_INVITATION_ACCEPTED',
  SUPPORT_REPLY_RECEIVED: 'SUPPORT_REPLY_RECEIVED'
} as const)
export type NotificationType = ValueOf<typeof NotificationTypeValue>

export const PushPlatformValue = Object.freeze({
  WEBPUSH: 'WEBPUSH',
  FCM: 'FCM'
} as const)
export type PushPlatform = ValueOf<typeof PushPlatformValue>

export const ProfileLinkKindValue = Object.freeze({
  STYLIST: 'STYLIST',
  SALON: 'SALON'
} as const)
export type ProfileLinkKind = ValueOf<typeof ProfileLinkKindValue>

// ============================================================
// MODEL TYPES (from Prisma schema)
// ============================================================

export type Account = {
  id: IDStringType
  userId: IDType
  accountId: IDType
  providerId: IDType
  accessToken: string | null
  refreshToken: string | null
  idToken: string | null
  accessTokenExpiresAt: DateAndTime | null
  refreshTokenExpiresAt: DateAndTime | null
  scope: string | null
  password: string | null
  createdAt: DateAndTime
  updatedAt: DateAndTime
}

export type Session = {
  id: IDStringType
  token: string
  userId: IDType
  expires: DateAndTime
  ip_address: string | null
  user_agent: string | null
  device_type: string | null
  createdAt: DateAndTime
  updatedAt: DateAndTime
}

export type Verification = {
  id: IDStringType
  identifier: string
  value: string
  expiresAt: DateAndTime
  createdAt: DateAndTime
  updatedAt: DateAndTime
}

export type ThrottleCounter = {
  key: IDStringType
  count: number
  window_start: DateAndTime
  expires_at: DateAndTime
}

export type JobLease = {
  job_name: IDStringType
  due_at: DateAndTime
  lease_owner: string | null
  lease_expires_at: DateAndTime | null
  last_started_at: DateAndTime | null
  last_completed_at: DateAndTime | null
  last_duration_ms: number | null
  last_error: string | null
  last_instance: string | null
  consecutive_failures: number
  run_count: number
  updated_at: DateAndTime
}

export type ImpersonationBackup = {
  ref_id: IDStringType
  admin_user_id: IDType
  backup_session_token: string
  original_session_id: IDType
  impersonated_user_id: IDType
  impersonated_session_token: string
  expires_at: DateAndTime
} & DateMetadata

export type AdminNote = {
  id: IDStringType
  notes: string
} & DateMetadata

export type Policy = {
  id: IDStringType
  title: string
  content: string
  is_main: boolean
} & DateMetadataWithUpdate

export type RoleEntity = {
  id: IDStringType
  name: string
  description: string | null
  is_system: boolean
} & DateMetadata

export type PermissionEntity = {
  id: IDStringType
  event_name: EVENT_COMMANDS_AND_QUERIES_TYPE
  description: string | null
  category: GROUP_KEY
  is_system: boolean
} & DateMetadata

export type RolePermissionEntity = {
  id: IDStringType
  role_id: IDType
  permission_id: IDType
} & DateMetadata

export type EventLog = {
  event_log_id: IDStringType
  event: EVENTS_ALL_TYPE
  created_by_user_id: IDType
  language: string | null
  location: string | null
  user_agent: string | null
  client_ip: string | null
  event_payload: Record<string, unknown> | null
  event_type: EventLogType
} & DateMetadata

export type AiCrawlerEvent = {
  id: IDStringType
  user_agent: string
  path: string
  ip_address: string | null
  country: string | null
  bot_name: string | null
  bot_category: AiCrawlerBotCategory | null
} & DateMetadata

export type StripeEvent = {
  id: IDStringType
  event_id: IDType
  event_type: string
  processed: boolean
  processed_at: DateAndTime | null
  retry_count: number
  last_attempt_at: DateAndTime
  last_error: string | null
  dead_lettered: boolean
} & DateMetadata

export type StylistAccount = {
  account_id: IDStringType
  created_by_user_id: IDType
  display_name: string | null
  pricing_plan: PricingPlan
  payment_status: PaymentStatus
  account_status: AccountStatus
  paid_staff_seats: number
  account_expiration_date: DateAndTime | null
  upcoming_payment_date: DateAndTime | null
  business_name: string | null
  address_street: string | null
  address_city: string | null
  address_postal_code: string | null
  address_country: string | null
  latitude: number | null
  longitude: number | null
  phone: string | null
  website: string | null
  external_links: Record<string, unknown> | null
  description: string | null
  dashboard_note: string | null
  vanity_url: string | null
  instagram_handle: string | null
  avatar_url: string | null
  avatar_public_id: IDType | null
  brand_accent_color: string | null
  salon_vanity_url: string | null
  salon_profile_name: string | null
  salon_brand_accent_color: string | null
  salon_show_team: boolean
  salon_external_links: Record<string, unknown> | null
  salon_logo_url: string | null
  salon_logo_public_id: IDType | null
  stripe_customer_id: IDType | null
  subscription_id: IDType | null
  subscription_status: SubscriptionStatus | null
  cancel_at_period_end: boolean | null
  cancel_at: DateAndTime | null
  current_period_end: DateAndTime | null
  last_stripe_event_at: DateAndTime | null
  trial_started_at: DateAndTime | null
  trial_ends_at: DateAndTime | null
  trial_reminder_sent: boolean | null
  plan_selected_at: DateAndTime | null
  email_preferences: EmailPreferences | null
  email_marketing: boolean
  email_trial_sequence: boolean
  admin_plan_override: boolean
  gallery_strength_dismissed_at: DateAndTime | null
  view_count: number
  cached_bookmark_count: number
  cached_gallery_count: number
  cached_likes_count: number
} & DateMetadata

export type CheckoutAttempt = {
  account_id: IDStringType
  attempt_id: IDType | null
  intent_fingerprint: string | null
  intent: Record<string, unknown> | null
  stripe_params: Record<string, unknown> | null
  response_meta: Record<string, unknown> | null
  stripe_session_id: IDType | null
  stripe_subscription_id: IDType | null
  customer_id: IDType | null
  phase: string
  lease_owner: string | null
  lease_expires_at: DateAndTime | null
  expires_at: DateAndTime | null
} & DateMetadataWithUpdate

export type ClientAccount = {
  client_account_id: IDStringType
  created_by_user_id: IDType
  contact_phone: string | null
  contact_email: string | null
  dashboard_note: string | null
} & DateMetadata

export type Color = {
  id: IDStringType
  name: string
  hex_code: string
  display_order: number
  is_active: boolean
} & DateMetadata

export type Trait = {
  id: IDStringType
  name: string
  category: TraitCategory
  icon_url: string | null
  display_order: number
  is_active: boolean
  is_featured: boolean
} & DateMetadata

export type GalleryRecordColor = {
  id: IDStringType
  gallery_record_id: IDType
  color_id: IDType
} & DateMetadata

export type GalleryRecordTrait = {
  id: IDStringType
  gallery_record_id: IDType
  trait_id: IDType
} & DateMetadata

export type GalleryRecord = {
  gallery_record_id: IDStringType
  created_by_account_id: IDType
  asset_url: string
  public_id: IDType | null
  nail_length: NailLength
  is_pinned: boolean
  pinned_position: number | null
  is_salon_pinned: boolean
  is_hidden: boolean
} & DateMetadata

export type User = {
  id: IDStringType
  email: string
  emailVerified: boolean
  image: string | null
  avatar_url: string | null
  avatar_public_id: IDType | null
  name: string
  role_id: SystemRoleIdType
  createdAt: DateAndTime
  updatedAt: DateAndTime
  is_active: boolean
  disabled_at: DateAndTime | null
  deleted_at: DateAndTime | null
  recovery_available: boolean
  account_type: AccountType
  notifications_enabled: boolean
  terms_accepted_at: DateAndTime | null
  last_login_at: DateAndTime | null
  moderation_strikes: number
  delete_confirm_version: number
}

export type DeletedUser = {
  user_id: IDStringType
  body: DeletedUserBackup
  email: string | null
  recovery_offered: boolean
  recovered_at: DateAndTime | null
  recovered_as_user_id: IDType | null
  is_gdpr_erased: boolean
  is_move_archive: boolean
} & DateMetadata

export type FavoriteStylist = {
  id: IDStringType
  client_user_id: IDType
  stylist_account_id: IDType
} & DateMetadata

export type FavoriteGalleryRecord = {
  id: IDStringType
  client_user_id: IDType
  gallery_record_id: IDType
  note: string | null
} & DateMetadata

export type SalonInvitation = {
  id: IDStringType
  salon_account_id: IDType
  email: string
  role: StaffRole
  token_hash: string
  expires_at: DateAndTime
  accepted_at: DateAndTime | null
  declined_at: DateAndTime | null
  attached_user_id: IDType | null
} & DateMetadata

export type StaffMember = {
  id: IDStringType
  stylist_account_id: IDType
  user_id: IDType
  role: StaffRole
  permissions: StaffPermission[]
  invited_at: DateAndTime
  accepted_at: DateAndTime | null
  public_profile_visible: boolean
  is_active: boolean
}

export type PairingSession = {
  id: IDStringType
  token: string
  stylist_account_id: IDType
  issued_by_user_id: IDType
  expires_at: DateAndTime
  claimed_by_client_user_id: IDType | null
  claimed_at: DateAndTime | null
  revoked_at: DateAndTime | null
} & DateMetadata

export type ClientStylistPair = {
  id: IDStringType
  client_user_id: IDType
  stylist_account_id: IDType
  paired_at: DateAndTime
  last_pair_request_at: DateAndTime | null
  paired_via_pairing_session_id: IDType | null
  status: PairingStatus
  revoked_at: DateAndTime | null
  revoked_by: AccountType | null
  salon_origin_account_id: IDType | null
  request_place: string | null
  request_note: string | null
  crm_note: string | null
  crm_note_updated_at: DateAndTime | null
  important_note: string | null
  important_note_updated_at: DateAndTime | null
  last_message_at: DateAndTime | null
  client_last_read_at: DateAndTime | null
  stylist_last_read_at: DateAndTime | null
  stylist_hidden_at: DateAndTime | null
  client_hidden_at: DateAndTime | null
}

export type StylistClientMessage = {
  id: IDStringType
  pair_id: IDType
  sender_type: StylistClientMessageSender
  content: string
  kind: SessionActivityKind
  session_id: IDType | null
  change_scope: SessionChangeScope | null
  event_key: string | null
  activity_at: DateAndTime
  revision: number
} & DateMetadata

export type SessionActivityOutbox = {
  event_key: IDStringType
  pair_id: IDType
  session_id: IDType
  message_id: IDType
  notification_id: IDType | null
  recipient_user_id: IDType
  kind: SessionActivityKind
  status: string
  lease_token: string | null
  leased_until: DateAndTime | null
  attempts: number
  next_attempt_at: DateAndTime
  last_error: string | null
  delivered_at: DateAndTime | null
} & DateMetadata

export type ContactAccessLog = {
  id: IDStringType
  client_user_id: IDType
  stylist_user_id: IDType
  accessed_at: DateAndTime
  access_type: ContactAccessType
  ip_address: string | null
  user_agent: string | null
}

export type FeatureFlag = {
  id: IDStringType
  key: string
  description: string | null
  is_enabled: boolean
  expires_at: DateAndTime | null
} & DateMetadataWithUpdate

export type Announcement = {
  id: IDStringType
  title: string
  message: string
  type: AnnouncementType
  is_active: boolean
  audience_anonymous: boolean
  audience_client: boolean
  audience_stylist: boolean
  translations: Record<string, unknown>
  notification_sent_at: DateAndTime | null
  starts_at: DateAndTime | null
  ends_at: DateAndTime | null
  created_by_user_id: IDType | null
} & DateMetadata

export type RuntimeConfig = {
  id: IDStringType
  key: string
  value: string
  value_type: RuntimeConfigValueType
  description: string | null
  is_predefined: boolean
  updated_by_user_id: IDType | null
} & DateMetadataWithUpdate

export type ContentReport = {
  id: IDStringType
  gallery_record_id: IDType | null
  reporter_id: IDType
  reason: ContentReportReason
  description: string | null
  status: ContentReportStatus
  admin_note: string | null
  resolved_by_id: IDType | null
  resolved_at: DateAndTime | null
} & DateMetadata

export type NewsletterSubscriber = {
  id: IDStringType
  email: string
  is_active: boolean
  confirmation_token: string | null
  confirmed_at: DateAndTime | null
  consent_timestamp: DateAndTime | null
  ip_address: string | null
  consent_source: string | null
} & DateMetadata

export type NewsletterConsentEvent = {
  id: number
  newsletter_id: IDType
  action: NewsletterConsentAction
  consent_timestamp: DateAndTime
  ip_address: string | null
  user_agent: string | null
}

export type SessionContainer = {
  id: IDStringType
  client_account_id: IDType
  stylist_account_id: IDType | null
  name: string | null
  lifecycle_state: SessionContainerLifecycleState
  stylist_note: string | null
  client_note: string | null
  shared_at: DateAndTime | null
  accepted_at: DateAndTime | null
  viewed_at: DateAndTime | null
  expiry_reminder_sent_at: DateAndTime | null
  last_client_change_at: DateAndTime | null
  expires_at: DateAndTime | null
  closed_at: DateAndTime | null
} & DateMetadataWithUpdate

export type SessionContainerPhoto = {
  id: IDStringType
  session_id: IDType
  gallery_record_id: IDType
  position: number
} & DateMetadata

export type VisitRecord = {
  id: IDStringType
  client_user_id: IDType
  stylist_account_id: IDType
  visit_date: DateAndTime
  service_note: string | null
  source: VisitRecordSource
  session_id: IDType | null
} & DateMetadataWithUpdate

export type VisitResultPhoto = {
  id: IDStringType
  visit_record_id: IDType
  stylist_account_id: IDType
  asset_url: string
  public_id: IDType | null
  position: number
} & DateMetadata

export type FailedEmail = {
  id: IDStringType
  recipient: string
  template: string
  subject: string
  payload: Record<string, unknown>
  error: string
  attempts: number
  resolved_at: DateAndTime | null
  resolved_by: string | null
} & DateMetadata

export type SupportThread = {
  id: IDStringType
  user_id: IDType
  subject: string
  category: SupportThreadCategory | null
  status: SupportThreadStatus
  user_last_read_at: DateAndTime
} & DateMetadataWithUpdate

export type SupportMessage = {
  id: IDStringType
  thread_id: IDType
  sender_type: SupportSenderType
  content: string
} & DateMetadata

export type ModerationStrike = {
  id: IDStringType
  user_id: IDType
  reason: string
  issued_at: DateAndTime
  expires_at: DateAndTime
  issued_by: string
}

export type SalonShowcaseWork = {
  salon_account_id: IDType
  gallery_record_id: IDType
}

export type Notification = {
  id: IDStringType
  user_id: IDType
  recipient_role: AccountType | null
  type: NotificationType
  dedup_key: string
  actor_user_id: IDType | null
  actor_name: string | null
  announcement_id: IDType | null
  target_path: string
  read_at: DateAndTime | null
  activity_kind: SessionActivityKind | null
  session_id: IDType | null
  change_scope: SessionChangeScope | null
} & DateMetadata

export type PushSubscription = {
  id: IDStringType
  user_id: IDType
  platform: PushPlatform
  endpoint: string
  p256dh: string | null
  auth: string | null
  user_agent: string | null
  last_seen_at: DateAndTime
  failed_at: DateAndTime | null
} & DateMetadata

export type FreeEmailEnrollment = {
  id: IDStringType
  accountId: IDType
  userId: IDType
  cohort: string
  version: string
  startedAt: DateAndTime
  status: string
  finishedAt: DateAndTime | null
  finishReason: string | null
}

export type EmailLifecycleCampaign = {
  id: IDStringType
  mode: string
  startedAt: DateAndTime | null
  initializedAt: DateAndTime | null
  updatedAt: DateAndTime
}

export type EmailLifecycleMessage = {
  id: IDStringType
  userId: IDType
  accountId: IDType
  family: string
  ruleId: IDType
  templateId: IDType
  occurrence: string
  contentVersion: string
  sweepId: IDType | null
  opportunityId: IDType | null
  nonTransactional: boolean
  recipientAddressHash: string | null
  locale: string
  cohort: string
  ctaIds: string[]
  status: string
  provider: string | null
  providerMessageId: IDType | null
  scheduledAt: DateAndTime
  createdAt: DateAndTime
  startedAt: DateAndTime | null
  acceptedAt: DateAndTime | null
  deliveryStatus: string | null
  deliveryAt: DateAndTime | null
  reason: string | null
  outbox: boolean
  outboxPayload: Record<string, unknown> | null
  attempts: number
  nextAttemptAt: DateAndTime | null
  deadLetteredAt: DateAndTime | null
}

export type EmailDeliveryEvent = {
  id: IDStringType
  provider: string
  providerEventId: IDType
  replayToken: string | null
  messageId: IDType
  kind: string
  occurredAt: DateAndTime
  createdAt: DateAndTime
}

export type EmailDeliverySuppression = {
  addressHash: IDStringType
  reason: string
  createdAt: DateAndTime
}

export type EmailLifecycleEntry = {
  id: IDStringType
  messageId: IDType
  userId: IDType
  ctaId: IDType
  createdAt: DateAndTime
}

export type EmailLifecycleOperationalEvent = {
  id: IDStringType
  messageId: IDType | null
  kind: string
  state: string | null
  reason: string | null
  dimensions: Record<string, unknown>
  occurredAt: DateAndTime
  exportedAt: DateAndTime | null
}

export type EmailLifecycleAction = {
  id: IDStringType
  userId: IDType
  accountId: IDType
  kind: string
  occurredAt: DateAndTime
}

export type ProfileLinkAlias = {
  kind: ProfileLinkKind
  slug: string
  account_id: IDType
} & DateMetadata
