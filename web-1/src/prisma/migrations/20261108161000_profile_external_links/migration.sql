-- Personal and salon profile links (max 3, validated as https on write/read).
ALTER TABLE "StylistAccount" ADD COLUMN IF NOT EXISTS "external_links" JSONB;
ALTER TABLE "StylistAccount" ADD COLUMN IF NOT EXISTS "salon_external_links" JSONB;
