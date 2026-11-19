ALTER TABLE "StylistAccount" ADD COLUMN "salon_vanity_url" TEXT;
CREATE UNIQUE INDEX "StylistAccount_salon_vanity_url_key" ON "StylistAccount"("salon_vanity_url");
