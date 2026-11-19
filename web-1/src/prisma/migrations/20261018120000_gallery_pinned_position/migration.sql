-- Additive: stylist-chosen order of pinned works on the public profile.
ALTER TABLE "GalleryRecord" ADD COLUMN "pinned_position" INTEGER;

-- Backfill: every pinned record gets the position it already had on the public
-- profile (newest first, cuid tiebreaker), so nothing moves on deploy.
UPDATE "GalleryRecord" AS g
SET "pinned_position" = ranked."position"
FROM (
  SELECT "gallery_record_id",
         (ROW_NUMBER() OVER (
           PARTITION BY "created_by_account_id"
           ORDER BY "created_at" DESC, "gallery_record_id" DESC
         ) - 1)::INTEGER AS "position"
  FROM "GalleryRecord"
  WHERE "is_pinned" = true
) AS ranked
WHERE g."gallery_record_id" = ranked."gallery_record_id";
