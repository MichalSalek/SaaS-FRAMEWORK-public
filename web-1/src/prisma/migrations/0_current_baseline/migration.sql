-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtensions (re-injected by scripts/prepend-baseline-extensions.mjs after every regen).
-- prisma migrate diff omits extensions (they live outside schema.prisma); the GIN trigram
-- indexes below REQUIRE pg_trgm. SSOT for this list: docker/postgres/initdb.d/01-extensions.sql.
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";


-- CreateEnum
CREATE TYPE "EventLogType" AS ENUM ('ACCOUNT', 'LOGIN', 'GALLERY', 'ADMIN', 'DOMAIN', 'EMAIL');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('STYLIST', 'CLIENT');

-- CreateEnum
CREATE TYPE "NailLength" AS ENUM ('SHORT', 'MEDIUM', 'LONG', 'XL');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELED', 'INCOMPLETE', 'INCOMPLETE_EXPIRED', 'PAST_DUE', 'TRIALING', 'UNPAID', 'PAUSED');

-- CreateEnum
CREATE TYPE "PricingPlan" AS ENUM ('FREE', 'PRO', 'PRO_PLUS', 'STUDIO', 'SCALE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PAID', 'IN_PROGRESS', 'REJECTED');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'NOT_ACTIVE', 'EXPIRING', 'EXPIRED');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('OWNER', 'MANAGER', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "PairingStatus" AS ENUM ('ACTIVE', 'REVOKED', 'PENDING');

-- CreateEnum
CREATE TYPE "StylistClientMessageSender" AS ENUM ('STYLIST', 'CLIENT');

-- CreateEnum
CREATE TYPE "VisitRecordSource" AS ENUM ('SESSION', 'MANUAL');

-- CreateEnum
CREATE TYPE "ContentReportReason" AS ENUM ('INAPPROPRIATE', 'FACE', 'SPAM', 'OTHER');

-- CreateEnum
CREATE TYPE "ContentReportStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SessionContainerLifecycleState" AS ENUM ('DRAFT', 'READY', 'SHARED', 'ACTIVE', 'EXPIRED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportThreadStatus" AS ENUM ('OPEN', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportSenderType" AS ENUM ('USER', 'SUPPORT');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMP(3),
    "refresh_token_expires_at" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "session_token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "device_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpersonationBackup" (
    "ref_id" TEXT NOT NULL,
    "admin_user_id" TEXT NOT NULL,
    "backup_session_token" TEXT NOT NULL,
    "original_session_id" TEXT NOT NULL,
    "impersonated_user_id" TEXT NOT NULL,
    "impersonated_session_token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpersonationBackup_pkey" PRIMARY KEY ("ref_id")
);

-- CreateTable
CREATE TABLE "AdminNote" (
    "id" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "is_main" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventLog" (
    "event_log_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "language" TEXT,
    "location" TEXT,
    "user_agent" TEXT,
    "client_ip" TEXT,
    "event_payload" JSONB,
    "event_type" "EventLogType" NOT NULL,

    CONSTRAINT "EventLog_pkey" PRIMARY KEY ("event_log_id")
);

-- CreateTable
CREATE TABLE "AiCrawlerEvent" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_agent" VARCHAR(2000) NOT NULL,
    "path" VARCHAR(500) NOT NULL,
    "ip_address" VARCHAR(100),
    "country" VARCHAR(10),
    "bot_name" VARCHAR(100),
    "bot_category" VARCHAR(50),

    CONSTRAINT "AiCrawlerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "deadLettered" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StylistAccount" (
    "account_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" TEXT NOT NULL,
    "display_name" TEXT,
    "pricing_plan" "PricingPlan" NOT NULL,
    "payment_status" "PaymentStatus" NOT NULL,
    "account_status" "AccountStatus" NOT NULL,
    "paid_staff_seats" INTEGER NOT NULL DEFAULT 0,
    "account_expiration_date" TIMESTAMP(3),
    "upcoming_payment_date" TIMESTAMP(3),
    "business_name" TEXT,
    "address_street" TEXT,
    "address_city" TEXT,
    "address_postal_code" TEXT,
    "address_country" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "phone" TEXT,
    "website" TEXT,
    "description" TEXT,
    "dashboard_note" TEXT,
    "vanity_url" TEXT,
    "instagram_handle" TEXT,
    "avatar_url" TEXT,
    "brand_accent_color" VARCHAR(7),
    "stripe_customer_id" TEXT,
    "subscription_id" TEXT,
    "subscription_status" "SubscriptionStatus",
    "cancel_at_period_end" BOOLEAN DEFAULT false,
    "cancel_at" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "last_stripe_event_at" TIMESTAMP(3),
    "trial_started_at" TIMESTAMP(3),
    "trial_ends_at" TIMESTAMP(3),
    "trial_reminder_sent" BOOLEAN DEFAULT false,
    "plan_selected_at" TIMESTAMP(3),
    "email_preferences" JSONB DEFAULT '{"trial_sequence":true,"marketing":true}',
    "email_marketing" BOOLEAN NOT NULL DEFAULT true,
    "email_trial_sequence" BOOLEAN NOT NULL DEFAULT true,
    "admin_plan_override" BOOLEAN NOT NULL DEFAULT false,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "cached_bookmark_count" INTEGER NOT NULL DEFAULT 0,
    "cached_gallery_count" INTEGER NOT NULL DEFAULT 0,
    "cached_likes_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StylistAccount_pkey" PRIMARY KEY ("account_id")
);

-- CreateTable
CREATE TABLE "ClientAccount" (
    "client_account_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" TEXT NOT NULL,
    "contact_phone" TEXT,
    "contact_email" TEXT,
    "dashboard_note" TEXT,

    CONSTRAINT "ClientAccount_pkey" PRIMARY KEY ("client_account_id")
);

-- CreateTable
CREATE TABLE "Color" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hex_code" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Color_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trait" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "icon_url" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trait_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GalleryRecordColor" (
    "id" TEXT NOT NULL,
    "gallery_record_id" TEXT NOT NULL,
    "color_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GalleryRecordColor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GalleryRecordTrait" (
    "id" TEXT NOT NULL,
    "gallery_record_id" TEXT NOT NULL,
    "trait_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GalleryRecordTrait_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GalleryRecord" (
    "gallery_record_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_account_id" TEXT NOT NULL,
    "asset_url" TEXT NOT NULL,
    "nail_length" "NailLength" NOT NULL,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "is_hidden" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "GalleryRecord_pkey" PRIMARY KEY ("gallery_record_id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "name" VARCHAR(200) NOT NULL DEFAULT '',
    "role_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "disabled_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "recovery_available" BOOLEAN NOT NULL DEFAULT false,
    "account_type" "AccountType" NOT NULL DEFAULT 'CLIENT',
    "notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
    "moderation_strikes" INTEGER NOT NULL DEFAULT 0,
    "delete_confirm_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeletedUser" (
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "body" JSONB NOT NULL,
    "email" TEXT,
    "recovery_offered" BOOLEAN NOT NULL DEFAULT false,
    "recovered_at" TIMESTAMP(3),
    "recovered_as_user_id" TEXT,
    "is_gdpr_erased" BOOLEAN NOT NULL DEFAULT false,
    "is_move_archive" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DeletedUser_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "FavoriteStylist" (
    "id" TEXT NOT NULL,
    "client_user_id" TEXT NOT NULL,
    "stylist_account_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FavoriteStylist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FavoriteGalleryRecord" (
    "id" TEXT NOT NULL,
    "client_user_id" TEXT NOT NULL,
    "gallery_record_id" TEXT NOT NULL,
    "note" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FavoriteGalleryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffMember" (
    "id" TEXT NOT NULL,
    "stylist_account_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL DEFAULT 'EMPLOYEE',
    "permissions" TEXT[],
    "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "StaffMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PairingSession" (
    "id" TEXT NOT NULL,
    "token" VARCHAR(32) NOT NULL,
    "stylist_account_id" TEXT NOT NULL,
    "issued_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "claimed_by_client_user_id" TEXT,
    "claimed_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "PairingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientStylistPair" (
    "id" TEXT NOT NULL,
    "client_user_id" TEXT NOT NULL,
    "stylist_account_id" TEXT NOT NULL,
    "paired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paired_via_pairing_session_id" TEXT,
    "status" "PairingStatus" NOT NULL DEFAULT 'ACTIVE',
    "revoked_at" TIMESTAMP(3),
    "crm_note" TEXT,
    "crm_note_updated_at" TIMESTAMP(3),
    "last_message_at" TIMESTAMP(3),
    "client_last_read_at" TIMESTAMP(3),
    "stylist_last_read_at" TIMESTAMP(3),

    CONSTRAINT "ClientStylistPair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StylistClientMessage" (
    "id" TEXT NOT NULL,
    "pair_id" TEXT NOT NULL,
    "sender_type" "StylistClientMessageSender" NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StylistClientMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactAccessLog" (
    "id" TEXT NOT NULL,
    "client_user_id" TEXT NOT NULL,
    "stylist_user_id" TEXT NOT NULL,
    "accessed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "access_type" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "ContactAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_config" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "max_gallery_records" INTEGER NOT NULL,
    "max_pinned_records" INTEGER NOT NULL,
    "max_paired_clients" INTEGER NOT NULL,
    "max_shares_per_hour" INTEGER NOT NULL,
    "can_use_session_share" BOOLEAN NOT NULL,
    "can_use_multi_session" BOOLEAN NOT NULL,
    "can_use_staff_accounts" BOOLEAN NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'info',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runtime_configs" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "value_type" TEXT NOT NULL,
    "description" TEXT,
    "is_predefined" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_user_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runtime_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentReport" (
    "id" TEXT NOT NULL,
    "gallery_record_id" TEXT,
    "reporter_id" TEXT NOT NULL,
    "reason" "ContentReportReason" NOT NULL,
    "description" VARCHAR(1000),
    "status" "ContentReportStatus" NOT NULL DEFAULT 'PENDING',
    "admin_note" TEXT,
    "resolved_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "ContentReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsletterSubscriber" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "confirmation_token" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "consent_timestamp" TIMESTAMP(3),
    "ip_address" TEXT,
    "consent_source" TEXT,

    CONSTRAINT "NewsletterSubscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsletterConsentEvent" (
    "id" SERIAL NOT NULL,
    "newsletter_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "consent_timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "NewsletterConsentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionContainer" (
    "id" TEXT NOT NULL,
    "client_account_id" TEXT NOT NULL,
    "stylist_account_id" TEXT,
    "name" VARCHAR(100),
    "lifecycle_state" "SessionContainerLifecycleState" NOT NULL DEFAULT 'DRAFT',
    "stylist_note" VARCHAR(500),
    "client_note" VARCHAR(500),
    "shared_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionContainer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionContainerPhoto" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "gallery_record_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionContainerPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitRecord" (
    "id" TEXT NOT NULL,
    "client_user_id" TEXT NOT NULL,
    "stylist_account_id" TEXT NOT NULL,
    "visit_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "service_note" VARCHAR(1000),
    "source" "VisitRecordSource" NOT NULL DEFAULT 'MANUAL',
    "session_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitResultPhoto" (
    "id" TEXT NOT NULL,
    "visit_record_id" TEXT NOT NULL,
    "stylist_account_id" TEXT NOT NULL,
    "asset_url" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitResultPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FailedEmail" (
    "id" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "error" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,

    CONSTRAINT "FailedEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportThread" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "SupportThreadStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "sender_type" "SupportSenderType" NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationStrike" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "reason" VARCHAR(2000) NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "issued_by" TEXT NOT NULL,

    CONSTRAINT "ModerationStrike_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Account_user_id_idx" ON "Account"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_id_account_id_key" ON "Account"("provider_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "Session_session_token_key" ON "Session"("session_token");

-- CreateIndex
CREATE INDEX "Session_expires_idx" ON "Session"("expires");

-- CreateIndex
CREATE INDEX "Session_user_id_expires_idx" ON "Session"("user_id", "expires");

-- CreateIndex
CREATE UNIQUE INDEX "Verification_identifier_value_key" ON "Verification"("identifier", "value");

-- CreateIndex
CREATE UNIQUE INDEX "ImpersonationBackup_admin_user_id_key" ON "ImpersonationBackup"("admin_user_id");

-- CreateIndex
CREATE INDEX "ImpersonationBackup_expires_at_idx" ON "ImpersonationBackup"("expires_at");

-- CreateIndex
CREATE INDEX "Policy_is_main_idx" ON "Policy"("is_main");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_event_name_key" ON "Permission"("event_name");

-- CreateIndex
CREATE INDEX "Permission_category_idx" ON "Permission"("category");

-- CreateIndex
CREATE INDEX "RolePermission_permission_id_idx" ON "RolePermission"("permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_role_id_permission_id_key" ON "RolePermission"("role_id", "permission_id");

-- CreateIndex
CREATE INDEX "EventLog_created_by_user_id_event_type_created_at_idx" ON "EventLog"("created_by_user_id", "event_type", "created_at" ASC);

-- CreateIndex
CREATE INDEX "EventLog_event_created_at_idx" ON "EventLog"("event", "created_at" DESC);

-- CreateIndex
CREATE INDEX "EventLog_event_type_created_at_idx" ON "EventLog"("event_type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "AiCrawlerEvent_bot_name_idx" ON "AiCrawlerEvent"("bot_name");

-- CreateIndex
CREATE INDEX "AiCrawlerEvent_bot_category_idx" ON "AiCrawlerEvent"("bot_category");

-- CreateIndex
CREATE INDEX "AiCrawlerEvent_path_idx" ON "AiCrawlerEvent"("path");

-- CreateIndex
CREATE INDEX "AiCrawlerEvent_created_at_bot_name_idx" ON "AiCrawlerEvent"("created_at", "bot_name");

-- CreateIndex
CREATE INDEX "AiCrawlerEvent_created_at_bot_category_idx" ON "AiCrawlerEvent"("created_at", "bot_category");

-- CreateIndex
CREATE UNIQUE INDEX "StripeEvent_eventId_key" ON "StripeEvent"("eventId");

-- CreateIndex
CREATE INDEX "StripeEvent_processed_deadLettered_createdAt_idx" ON "StripeEvent"("processed", "deadLettered", "createdAt");

-- CreateIndex
CREATE INDEX "StripeEvent_deadLettered_createdAt_idx" ON "StripeEvent"("deadLettered", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StylistAccount_created_by_user_id_key" ON "StylistAccount"("created_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "StylistAccount_vanity_url_key" ON "StylistAccount"("vanity_url");

-- CreateIndex
CREATE UNIQUE INDEX "StylistAccount_stripe_customer_id_key" ON "StylistAccount"("stripe_customer_id");

-- CreateIndex
CREATE INDEX "StylistAccount_account_status_address_city_latitude_longitu_idx" ON "StylistAccount"("account_status", "address_city", "latitude", "longitude");

-- CreateIndex
CREATE INDEX "StylistAccount_subscription_status_idx" ON "StylistAccount"("subscription_status");

-- CreateIndex
CREATE INDEX "StylistAccount_account_status_account_id_idx" ON "StylistAccount"("account_status", "account_id");

-- CreateIndex
CREATE INDEX "StylistAccount_account_status_cached_gallery_count_idx" ON "StylistAccount"("account_status", "cached_gallery_count" DESC);

-- CreateIndex
CREATE INDEX "StylistAccount_trial_started_at_idx" ON "StylistAccount"("trial_started_at");

-- CreateIndex
CREATE INDEX "StylistAccount_trial_started_at_payment_status_idx" ON "StylistAccount"("trial_started_at", "payment_status");

-- CreateIndex
CREATE INDEX "StylistAccount_payment_status_current_period_end_idx" ON "StylistAccount"("payment_status", "current_period_end");

-- CreateIndex
CREATE INDEX "StylistAccount_address_city_idx" ON "StylistAccount"("address_city");

-- CreateIndex
CREATE INDEX "stylist_account_display_name_trgm_idx" ON "StylistAccount" USING GIN ("display_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "stylist_account_business_name_trgm_idx" ON "StylistAccount" USING GIN ("business_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "stylist_account_address_city_trgm_idx" ON "StylistAccount" USING GIN ("address_city" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "ClientAccount_created_by_user_id_key" ON "ClientAccount"("created_by_user_id");

-- CreateIndex
CREATE INDEX "ClientAccount_contact_phone_idx" ON "ClientAccount"("contact_phone");

-- CreateIndex
CREATE INDEX "ClientAccount_contact_email_idx" ON "ClientAccount"("contact_email");

-- CreateIndex
CREATE UNIQUE INDEX "Color_name_key" ON "Color"("name");

-- CreateIndex
CREATE INDEX "Color_is_active_display_order_idx" ON "Color"("is_active", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "Trait_name_key" ON "Trait"("name");

-- CreateIndex
CREATE INDEX "Trait_is_active_is_featured_category_display_order_idx" ON "Trait"("is_active", "is_featured" DESC, "category", "display_order");

-- CreateIndex
CREATE INDEX "Trait_category_idx" ON "Trait"("category");

-- CreateIndex
CREATE INDEX "GalleryRecordColor_color_id_gallery_record_id_idx" ON "GalleryRecordColor"("color_id", "gallery_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "GalleryRecordColor_gallery_record_id_color_id_key" ON "GalleryRecordColor"("gallery_record_id", "color_id");

-- CreateIndex
CREATE INDEX "GalleryRecordTrait_trait_id_gallery_record_id_idx" ON "GalleryRecordTrait"("trait_id", "gallery_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "GalleryRecordTrait_gallery_record_id_trait_id_key" ON "GalleryRecordTrait"("gallery_record_id", "trait_id");

-- CreateIndex
CREATE INDEX "GalleryRecord_is_pinned_created_at_idx" ON "GalleryRecord"("is_pinned", "created_at" DESC);

-- CreateIndex
CREATE INDEX "GalleryRecord_created_by_account_id_nail_length_idx" ON "GalleryRecord"("created_by_account_id", "nail_length");

-- CreateIndex
CREATE INDEX "GalleryRecord_nail_length_created_at_idx" ON "GalleryRecord"("nail_length", "created_at" DESC);

-- CreateIndex
CREATE INDEX "GalleryRecord_created_at_gallery_record_id_idx" ON "GalleryRecord"("created_at" DESC, "gallery_record_id");

-- CreateIndex
CREATE INDEX "GalleryRecord_created_by_account_id_is_hidden_created_at_idx" ON "GalleryRecord"("created_by_account_id", "is_hidden", "created_at" DESC);

-- CreateIndex
CREATE INDEX "GalleryRecord_is_hidden_created_at_idx" ON "GalleryRecord"("is_hidden", "created_at" DESC);

-- CreateIndex
CREATE INDEX "GalleryRecord_created_by_account_id_is_pinned_is_hidden_cre_idx" ON "GalleryRecord"("created_by_account_id", "is_pinned", "is_hidden", "created_at" DESC);

-- CreateIndex
CREATE INDEX "GalleryRecord_created_by_account_id_is_pinned_created_at_ga_idx" ON "GalleryRecord"("created_by_account_id", "is_pinned", "created_at" DESC, "gallery_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_id_idx" ON "users"("role_id");

-- CreateIndex
CREATE INDEX "users_name_idx" ON "users"("name");

-- CreateIndex
CREATE INDEX "users_is_active_idx" ON "users"("is_active");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

-- CreateIndex
CREATE INDEX "users_recovery_available_deleted_at_idx" ON "users"("recovery_available", "deleted_at");

-- CreateIndex
CREATE INDEX "users_account_type_created_at_idx" ON "users"("account_type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "users_email_trgm_idx" ON "users" USING GIN ("email" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "users_name_trgm_idx" ON "users" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "DeletedUser_created_at_idx" ON "DeletedUser"("created_at");

-- CreateIndex
CREATE INDEX "DeletedUser_email_idx" ON "DeletedUser"("email");

-- CreateIndex
CREATE INDEX "FavoriteStylist_client_user_id_created_at_idx" ON "FavoriteStylist"("client_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "FavoriteStylist_stylist_account_id_idx" ON "FavoriteStylist"("stylist_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "FavoriteStylist_client_user_id_stylist_account_id_key" ON "FavoriteStylist"("client_user_id", "stylist_account_id");

-- CreateIndex
CREATE INDEX "FavoriteGalleryRecord_client_user_id_created_at_idx" ON "FavoriteGalleryRecord"("client_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "FavoriteGalleryRecord_gallery_record_id_idx" ON "FavoriteGalleryRecord"("gallery_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "FavoriteGalleryRecord_client_user_id_gallery_record_id_key" ON "FavoriteGalleryRecord"("client_user_id", "gallery_record_id");

-- CreateIndex
CREATE INDEX "StaffMember_user_id_is_active_idx" ON "StaffMember"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "StaffMember_stylist_account_id_is_active_idx" ON "StaffMember"("stylist_account_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "StaffMember_stylist_account_id_user_id_key" ON "StaffMember"("stylist_account_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "PairingSession_token_key" ON "PairingSession"("token");

-- CreateIndex
CREATE INDEX "PairingSession_stylist_account_id_created_at_idx" ON "PairingSession"("stylist_account_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "PairingSession_expires_at_idx" ON "PairingSession"("expires_at");

-- CreateIndex
CREATE INDEX "ClientStylistPair_client_user_id_status_paired_at_idx" ON "ClientStylistPair"("client_user_id", "status", "paired_at" DESC);

-- CreateIndex
CREATE INDEX "ClientStylistPair_stylist_account_id_status_paired_at_idx" ON "ClientStylistPair"("stylist_account_id", "status", "paired_at" DESC);

-- CreateIndex
CREATE INDEX "ClientStylistPair_client_user_id_last_message_at_idx" ON "ClientStylistPair"("client_user_id", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "ClientStylistPair_stylist_account_id_last_message_at_idx" ON "ClientStylistPair"("stylist_account_id", "last_message_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ClientStylistPair_client_user_id_stylist_account_id_key" ON "ClientStylistPair"("client_user_id", "stylist_account_id");

-- CreateIndex
CREATE INDEX "StylistClientMessage_pair_id_created_at_idx" ON "StylistClientMessage"("pair_id", "created_at" ASC);

-- CreateIndex
CREATE INDEX "ContactAccessLog_client_user_id_accessed_at_idx" ON "ContactAccessLog"("client_user_id", "accessed_at");

-- CreateIndex
CREATE INDEX "ContactAccessLog_stylist_user_id_accessed_at_idx" ON "ContactAccessLog"("stylist_user_id", "accessed_at");

-- CreateIndex
CREATE INDEX "ContactAccessLog_client_user_id_stylist_user_id_accessed_at_idx" ON "ContactAccessLog"("client_user_id", "stylist_user_id", "accessed_at");

-- CreateIndex
CREATE INDEX "ContactAccessLog_accessed_at_idx" ON "ContactAccessLog"("accessed_at");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_key_key" ON "FeatureFlag"("key");

-- CreateIndex
CREATE INDEX "FeatureFlag_expires_at_idx" ON "FeatureFlag"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "plan_config_plan_id_key" ON "plan_config"("plan_id");

-- CreateIndex
CREATE INDEX "Announcement_is_active_starts_at_ends_at_idx" ON "Announcement"("is_active", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "Announcement_created_at_idx" ON "Announcement"("created_at");

-- CreateIndex
CREATE INDEX "Announcement_created_by_user_id_idx" ON "Announcement"("created_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "runtime_configs_key_key" ON "runtime_configs"("key");

-- CreateIndex
CREATE INDEX "runtime_configs_updated_by_user_id_idx" ON "runtime_configs"("updated_by_user_id");

-- CreateIndex
CREATE INDEX "ContentReport_gallery_record_id_idx" ON "ContentReport"("gallery_record_id");

-- CreateIndex
CREATE INDEX "ContentReport_status_created_at_idx" ON "ContentReport"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ContentReport_reporter_id_created_at_idx" ON "ContentReport"("reporter_id", "created_at");

-- CreateIndex
CREATE INDEX "ContentReport_created_at_id_idx" ON "ContentReport"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "NewsletterSubscriber_email_key" ON "NewsletterSubscriber"("email");

-- CreateIndex
CREATE UNIQUE INDEX "NewsletterSubscriber_confirmation_token_key" ON "NewsletterSubscriber"("confirmation_token");

-- CreateIndex
CREATE INDEX "NewsletterSubscriber_email_idx" ON "NewsletterSubscriber"("email");

-- CreateIndex
CREATE INDEX "NewsletterSubscriber_is_active_created_at_idx" ON "NewsletterSubscriber"("is_active", "created_at");

-- CreateIndex
CREATE INDEX "NewsletterSubscriber_confirmation_token_idx" ON "NewsletterSubscriber"("confirmation_token");

-- CreateIndex
CREATE INDEX "NewsletterConsentEvent_newsletter_id_consent_timestamp_idx" ON "NewsletterConsentEvent"("newsletter_id", "consent_timestamp" DESC);

-- CreateIndex
CREATE INDEX "SessionContainer_client_account_id_lifecycle_state_idx" ON "SessionContainer"("client_account_id", "lifecycle_state");

-- CreateIndex
CREATE INDEX "SessionContainer_client_account_id_shared_at_idx" ON "SessionContainer"("client_account_id", "shared_at");

-- CreateIndex
CREATE INDEX "SessionContainer_stylist_account_id_lifecycle_state_idx" ON "SessionContainer"("stylist_account_id", "lifecycle_state");

-- CreateIndex
CREATE INDEX "SessionContainer_expires_at_idx" ON "SessionContainer"("expires_at");

-- CreateIndex
CREATE INDEX "SessionContainerPhoto_gallery_record_id_idx" ON "SessionContainerPhoto"("gallery_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "SessionContainerPhoto_session_id_gallery_record_id_key" ON "SessionContainerPhoto"("session_id", "gallery_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "SessionContainerPhoto_session_id_position_key" ON "SessionContainerPhoto"("session_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "VisitRecord_session_id_key" ON "VisitRecord"("session_id");

-- CreateIndex
CREATE INDEX "VisitRecord_stylist_account_id_client_user_id_visit_date_idx" ON "VisitRecord"("stylist_account_id", "client_user_id", "visit_date" DESC);

-- CreateIndex
CREATE INDEX "VisitRecord_client_user_id_visit_date_idx" ON "VisitRecord"("client_user_id", "visit_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "VisitResultPhoto_visit_record_id_position_key" ON "VisitResultPhoto"("visit_record_id", "position");

-- CreateIndex
CREATE INDEX "FailedEmail_created_at_idx" ON "FailedEmail"("created_at");

-- CreateIndex
CREATE INDEX "FailedEmail_resolved_at_idx" ON "FailedEmail"("resolved_at");

-- CreateIndex
CREATE INDEX "FailedEmail_recipient_idx" ON "FailedEmail"("recipient");

-- CreateIndex
CREATE INDEX "SupportThread_user_id_idx" ON "SupportThread"("user_id");

-- CreateIndex
CREATE INDEX "SupportThread_status_id_idx" ON "SupportThread"("status", "id" DESC);

-- CreateIndex
CREATE INDEX "SupportMessage_thread_id_created_at_idx" ON "SupportMessage"("thread_id", "created_at" ASC);

-- CreateIndex
CREATE INDEX "ModerationStrike_user_id_expires_at_idx" ON "ModerationStrike"("user_id", "expires_at" DESC);

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StylistAccount" ADD CONSTRAINT "StylistAccount_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAccount" ADD CONSTRAINT "ClientAccount_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryRecordColor" ADD CONSTRAINT "GalleryRecordColor_gallery_record_id_fkey" FOREIGN KEY ("gallery_record_id") REFERENCES "GalleryRecord"("gallery_record_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryRecordColor" ADD CONSTRAINT "GalleryRecordColor_color_id_fkey" FOREIGN KEY ("color_id") REFERENCES "Color"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryRecordTrait" ADD CONSTRAINT "GalleryRecordTrait_gallery_record_id_fkey" FOREIGN KEY ("gallery_record_id") REFERENCES "GalleryRecord"("gallery_record_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryRecordTrait" ADD CONSTRAINT "GalleryRecordTrait_trait_id_fkey" FOREIGN KEY ("trait_id") REFERENCES "Trait"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryRecord" ADD CONSTRAINT "GalleryRecord_created_by_account_id_fkey" FOREIGN KEY ("created_by_account_id") REFERENCES "StylistAccount"("account_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoriteStylist" ADD CONSTRAINT "FavoriteStylist_client_user_id_fkey" FOREIGN KEY ("client_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoriteStylist" ADD CONSTRAINT "FavoriteStylist_stylist_account_id_fkey" FOREIGN KEY ("stylist_account_id") REFERENCES "StylistAccount"("account_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoriteGalleryRecord" ADD CONSTRAINT "FavoriteGalleryRecord_client_user_id_fkey" FOREIGN KEY ("client_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoriteGalleryRecord" ADD CONSTRAINT "FavoriteGalleryRecord_gallery_record_id_fkey" FOREIGN KEY ("gallery_record_id") REFERENCES "GalleryRecord"("gallery_record_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffMember" ADD CONSTRAINT "StaffMember_stylist_account_id_fkey" FOREIGN KEY ("stylist_account_id") REFERENCES "StylistAccount"("account_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffMember" ADD CONSTRAINT "StaffMember_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PairingSession" ADD CONSTRAINT "PairingSession_stylist_account_id_fkey" FOREIGN KEY ("stylist_account_id") REFERENCES "StylistAccount"("account_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientStylistPair" ADD CONSTRAINT "ClientStylistPair_client_user_id_fkey" FOREIGN KEY ("client_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientStylistPair" ADD CONSTRAINT "ClientStylistPair_stylist_account_id_fkey" FOREIGN KEY ("stylist_account_id") REFERENCES "StylistAccount"("account_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StylistClientMessage" ADD CONSTRAINT "StylistClientMessage_pair_id_fkey" FOREIGN KEY ("pair_id") REFERENCES "ClientStylistPair"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runtime_configs" ADD CONSTRAINT "runtime_configs_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_gallery_record_id_fkey" FOREIGN KEY ("gallery_record_id") REFERENCES "GalleryRecord"("gallery_record_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsletterConsentEvent" ADD CONSTRAINT "NewsletterConsentEvent_newsletter_id_fkey" FOREIGN KEY ("newsletter_id") REFERENCES "NewsletterSubscriber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionContainer" ADD CONSTRAINT "SessionContainer_client_account_id_fkey" FOREIGN KEY ("client_account_id") REFERENCES "ClientAccount"("client_account_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionContainer" ADD CONSTRAINT "SessionContainer_stylist_account_id_fkey" FOREIGN KEY ("stylist_account_id") REFERENCES "StylistAccount"("account_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionContainerPhoto" ADD CONSTRAINT "SessionContainerPhoto_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "SessionContainer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionContainerPhoto" ADD CONSTRAINT "SessionContainerPhoto_gallery_record_id_fkey" FOREIGN KEY ("gallery_record_id") REFERENCES "GalleryRecord"("gallery_record_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitRecord" ADD CONSTRAINT "VisitRecord_client_user_id_fkey" FOREIGN KEY ("client_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitRecord" ADD CONSTRAINT "VisitRecord_stylist_account_id_fkey" FOREIGN KEY ("stylist_account_id") REFERENCES "StylistAccount"("account_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitRecord" ADD CONSTRAINT "VisitRecord_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "SessionContainer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitResultPhoto" ADD CONSTRAINT "VisitResultPhoto_visit_record_id_fkey" FOREIGN KEY ("visit_record_id") REFERENCES "VisitRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "SupportThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationStrike" ADD CONSTRAINT "ModerationStrike_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
