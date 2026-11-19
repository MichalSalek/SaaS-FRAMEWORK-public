-- The stylist's first read of a shared/active session. Set once, best-effort,
-- so the client can see that the session is not stuck before acceptance.
ALTER TABLE "SessionContainer" ADD COLUMN IF NOT EXISTS "viewed_at" TIMESTAMP(3);
