-- Client card: „Ważne przed wizytą”, the stylist's short safety note about a client
-- (SCHEMA_DECISIONS.md#pair-important-note). Additive and nullable, no backfill, no index:
-- it is read only through rows already selected by the pair keys.
ALTER TABLE "ClientStylistPair" ADD COLUMN IF NOT EXISTS "important_note" VARCHAR(200);
ALTER TABLE "ClientStylistPair" ADD COLUMN IF NOT EXISTS "important_note_updated_at" TIMESTAMP(3);
