-- Retired profile links (owner 2026-10-22): an old stylist or salon link stays reserved
-- for its account and 301-redirects to the current one (SCHEMA_DECISIONS.md#profile-link-alias).
-- Additive only: a new enum and a new table. No backfill: no history of earlier links exists.

-- CreateEnum
CREATE TYPE "ProfileLinkKind" AS ENUM ('STYLIST', 'SALON');

-- CreateTable
CREATE TABLE "ProfileLinkAlias" (
    "kind" "ProfileLinkKind" NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "account_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileLinkAlias_pkey" PRIMARY KEY ("kind","slug")
);

-- CreateIndex
CREATE INDEX "ProfileLinkAlias_account_id_idx" ON "ProfileLinkAlias"("account_id");

-- AddForeignKey
ALTER TABLE "ProfileLinkAlias" ADD CONSTRAINT "ProfileLinkAlias_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "StylistAccount"("account_id") ON DELETE CASCADE ON UPDATE CASCADE;
