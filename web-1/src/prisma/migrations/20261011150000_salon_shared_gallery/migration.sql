ALTER TABLE "ClientStylistPair" ADD COLUMN "salon_origin_account_id" TEXT;
CREATE INDEX "ClientStylistPair_salon_origin_account_id_status_idx" ON "ClientStylistPair"("salon_origin_account_id", "status");
CREATE TABLE "SalonShowcaseWork" (
  "salon_account_id" TEXT NOT NULL,
  "gallery_record_id" TEXT NOT NULL,
  CONSTRAINT "SalonShowcaseWork_pkey" PRIMARY KEY ("salon_account_id", "gallery_record_id"),
  CONSTRAINT "SalonShowcaseWork_salon_account_id_fkey" FOREIGN KEY ("salon_account_id") REFERENCES "StylistAccount"("account_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SalonShowcaseWork_gallery_record_id_fkey" FOREIGN KEY ("gallery_record_id") REFERENCES "GalleryRecord"("gallery_record_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SalonShowcaseWork_gallery_record_id_idx" ON "SalonShowcaseWork"("gallery_record_id");
INSERT INTO "SalonShowcaseWork" ("salon_account_id", "gallery_record_id") SELECT "created_by_account_id", "gallery_record_id" FROM "GalleryRecord" WHERE "is_salon_pinned" = true ON CONFLICT DO NOTHING;
