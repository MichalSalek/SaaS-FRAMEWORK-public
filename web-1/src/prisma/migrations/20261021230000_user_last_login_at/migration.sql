-- Admin users list: last sign-in, written by the Better Auth session.create.after hook.
-- Additive and nullable. No index: only the admin list sorts by it (SCHEMA_DECISIONS.md#user-last-login-at).
-- No backfill here: a production backfill is an owner decision (the one-off UPDATE from the newest
-- surviving session is in SCHEMA_DECISIONS.md#user-last-login-at). Until then the value fills in at
-- each sign-in and accounts without one sort last.
ALTER TABLE "users" ADD COLUMN "last_login_at" TIMESTAMP(3);
