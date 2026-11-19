-- Person photos belong to User; the salon has an independent brand image.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_url" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_public_id" TEXT;
ALTER TABLE "StylistAccount" ADD COLUMN IF NOT EXISTS "salon_logo_url" TEXT;
ALTER TABLE "StylistAccount" ADD COLUMN IF NOT EXISTS "salon_logo_public_id" TEXT;
CREATE INDEX IF NOT EXISTS "users_avatar_public_id_idx" ON "users"("avatar_public_id");
CREATE INDEX IF NOT EXISTS "StylistAccount_salon_logo_public_id_idx" ON "StylistAccount"("salon_logo_public_id");

UPDATE "users" AS person
SET "avatar_url" = stylist."avatar_url", "avatar_public_id" = stylist."avatar_public_id"
FROM "StylistAccount" AS stylist
WHERE stylist."created_by_user_id" = person."id"
  AND person."avatar_url" IS NULL AND stylist."avatar_url" IS NOT NULL;

-- The application preserves User -> StylistAccount lock ordering. Legacy
-- clients delegate to the same person writer and update a compatibility mirror.
-- Reconcile that mirror after old backend writers drain and before UI cutover.
