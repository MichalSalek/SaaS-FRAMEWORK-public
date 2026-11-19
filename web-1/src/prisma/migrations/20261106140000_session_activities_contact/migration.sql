BEGIN;

ALTER TYPE "PairingStatus" ADD VALUE IF NOT EXISTS 'CONTACT' BEFORE 'PENDING';
CREATE TYPE "SessionActivityKind" AS ENUM ('TEXT', 'SESSION_SUBMITTED', 'SESSION_ACCEPTED', 'SESSION_CHANGED');
CREATE TYPE "SessionChangeScope" AS ENUM ('PHOTOS', 'NOTE', 'PHOTOS_AND_NOTE');

ALTER TABLE "SessionContainer"
  ADD COLUMN "accepted_at" TIMESTAMP(3),
  ADD COLUMN "last_client_change_at" TIMESTAMP(3);

ALTER TABLE "StylistClientMessage"
  ADD COLUMN "kind" "SessionActivityKind" NOT NULL DEFAULT 'TEXT',
  ADD COLUMN "session_id" TEXT,
  ADD COLUMN "change_scope" "SessionChangeScope",
  ADD COLUMN "event_key" TEXT,
  ADD COLUMN "activity_at" TIMESTAMP(3),
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
UPDATE "StylistClientMessage" SET "activity_at" = "created_at";
ALTER TABLE "StylistClientMessage" ALTER COLUMN "activity_at" SET NOT NULL;
ALTER TABLE "StylistClientMessage" ALTER COLUMN "activity_at" SET DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX "StylistClientMessage_event_key_key" ON "StylistClientMessage"("event_key");
CREATE INDEX "StylistClientMessage_pair_id_activity_at_id_idx" ON "StylistClientMessage"("pair_id", "activity_at" DESC, "id" DESC);
CREATE INDEX "StylistClientMessage_pair_id_sender_type_activity_at_idx" ON "StylistClientMessage"("pair_id", "sender_type", "activity_at" DESC);

ALTER TABLE "Notification"
  ADD COLUMN "activity_kind" "SessionActivityKind",
  ADD COLUMN "session_id" TEXT,
  ADD COLUMN "change_scope" "SessionChangeScope";

CREATE TABLE "SessionActivityOutbox" (
  "event_key" TEXT NOT NULL PRIMARY KEY,
  "pair_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "notification_id" TEXT,
  "recipient_user_id" TEXT NOT NULL,
  "kind" "SessionActivityKind" NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "lease_token" TEXT,
  "leased_until" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_error" VARCHAR(1000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "delivered_at" TIMESTAMP(3)
);
CREATE INDEX "SessionActivityOutbox_status_next_attempt_at_idx" ON "SessionActivityOutbox"("status", "next_attempt_at");

COMMIT;
