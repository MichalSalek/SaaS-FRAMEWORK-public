ALTER TABLE "StylistAccount" ADD COLUMN "salon_profile_name" TEXT, ADD COLUMN "salon_brand_accent_color" VARCHAR(7), ADD COLUMN "salon_show_team" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "GalleryRecord" ADD COLUMN "is_salon_pinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StaffMember" ADD COLUMN "public_profile_visible" BOOLEAN NOT NULL DEFAULT true;
