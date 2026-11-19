CREATE TABLE "SalonInvitation" (
 "id" TEXT NOT NULL, "salon_account_id" TEXT NOT NULL, "email" TEXT NOT NULL,
 "role" "StaffRole" NOT NULL DEFAULT 'EMPLOYEE', "token_hash" VARCHAR(64) NOT NULL,
 "expires_at" TIMESTAMP(3) NOT NULL, "accepted_at" TIMESTAMP(3), "declined_at" TIMESTAMP(3),
 "attached_user_id" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "SalonInvitation_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "SalonInvitation_salon_account_id_fkey" FOREIGN KEY ("salon_account_id") REFERENCES "StylistAccount"("account_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SalonInvitation_token_hash_key" ON "SalonInvitation"("token_hash");
CREATE INDEX "SalonInvitation_salon_account_id_email_idx" ON "SalonInvitation"("salon_account_id", "email");
CREATE INDEX "SalonInvitation_email_accepted_at_idx" ON "SalonInvitation"("email", "accepted_at");
