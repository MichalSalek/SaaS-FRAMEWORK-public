-- Remind both sides three days before the inspiration session expires.
ALTER TABLE "SessionContainer" ADD COLUMN "expiry_reminder_sent_at" TIMESTAMP(3);

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SESSION_EXPIRING_SOON';
