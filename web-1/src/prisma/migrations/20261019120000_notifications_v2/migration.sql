-- Notifications v2 (S142, 2026-10-19): the notification centre rows and the
-- push subscriptions. Additive only: two enums, two tables, no change to
-- existing columns.
-- #notification-actor-soft-ref, #pushsubscription-endpoint-unique.
-- Plain CREATE INDEX (never CONCURRENTLY): `prisma migrate deploy` runs this file
-- in one transaction (lesson 2026-07-19). The tables are empty on creation, so
-- the locks are instant.

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('PAIR_REQUEST_RECEIVED', 'PAIR_REQUEST_ACCEPTED', 'PAIR_CONNECTED_BY_QR', 'SESSION_SHARED', 'SESSION_CLOSED_BY_STYLIST', 'MESSAGE_RECEIVED', 'SALON_INVITATION_RECEIVED', 'SALON_INVITATION_ACCEPTED');

-- CreateEnum
CREATE TYPE "PushPlatform" AS ENUM ('WEBPUSH', 'FCM');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "recipient_role" "AccountType",
    "type" "NotificationType" NOT NULL,
    "dedup_key" VARCHAR(200) NOT NULL,
    "actor_user_id" TEXT,
    "actor_name" VARCHAR(200),
    "target_path" VARCHAR(300) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" "PushPlatform" NOT NULL,
    "endpoint" VARCHAR(1000) NOT NULL,
    "p256dh" VARCHAR(200),
    "auth" VARCHAR(100),
    "user_agent" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failed_at" TIMESTAMP(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_user_id_dedup_key_key" ON "Notification"("user_id", "dedup_key");

-- CreateIndex
CREATE INDEX "Notification_user_id_created_at_id_idx" ON "Notification"("user_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Notification_user_id_read_at_idx" ON "Notification"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "Notification_created_at_idx" ON "Notification"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_user_id_failed_at_idx" ON "PushSubscription"("user_id", "failed_at");

-- CreateIndex
CREATE INDEX "PushSubscription_last_seen_at_idx" ON "PushSubscription"("last_seen_at");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
