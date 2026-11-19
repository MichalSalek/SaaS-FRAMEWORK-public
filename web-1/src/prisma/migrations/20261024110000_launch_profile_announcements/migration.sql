ALTER TABLE "ClientStylistPair" ADD COLUMN "request_place" VARCHAR(100), ADD COLUMN "request_note" VARCHAR(140);
ALTER TABLE "Announcement" ADD COLUMN "audience_anonymous" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "audience_client" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "audience_stylist" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "translations" JSONB NOT NULL DEFAULT '{}', ADD COLUMN "notification_sent_at" TIMESTAMP(3);
UPDATE "Announcement" SET "translations" = jsonb_build_object('pl', jsonb_build_object('title', "title", 'message', "message"));
ALTER TYPE "NotificationType" ADD VALUE 'SYSTEM_ANNOUNCEMENT';
ALTER TABLE "Notification" ADD COLUMN "announcement_id" TEXT;
CREATE INDEX "Notification_announcement_id_idx" ON "Notification"("announcement_id");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
