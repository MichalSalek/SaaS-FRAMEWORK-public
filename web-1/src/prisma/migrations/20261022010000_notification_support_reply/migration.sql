-- A support reply is a notification (2026-10-22): one more NotificationType value.
-- Additive only. ADD VALUE inside the migrate-deploy transaction is fine on
-- PostgreSQL 12+ because nothing in this file uses the new value.
ALTER TYPE "NotificationType" ADD VALUE 'SUPPORT_REPLY_RECEIVED';
