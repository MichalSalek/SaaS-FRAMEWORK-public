-- Replace conversation-list indexes with total-order variants used by keyset pagination.
--
-- DECISION (nie usuwaj tego komentarza):
-- Bez CONCURRENTLY. `prisma migrate deploy` wykonuje kazdy plik migracji w JEDNEJ
-- transakcji, a Postgres odrzuca CREATE/DROP INDEX CONCURRENTLY wewnatrz transakcji —
-- dokladnie to dwukrotnie polozylo build Rendera 2026-07-19 (build_failed, prod zostal
-- na artefakcie z 07-18). Na prod te indeksy zostaly zalozone RECZNIE (CONCURRENTLY,
-- poza transakcja) 2026-08-02 i migracja oznaczona `migrate resolve --applied`;
-- ten plik wykona sie wiec tylko na swiezych bazach (dev/staging/testy), gdzie
-- transakcyjny CREATE INDEX na pustych/malych tabelach jest poprawny i szybki.
CREATE INDEX "ClientStylistPair_client_user_id_last_message_at_id_idx"
ON "ClientStylistPair"("client_user_id", "last_message_at" DESC, "id" DESC);

CREATE INDEX "ClientStylistPair_stylist_account_id_last_message_at_id_idx"
ON "ClientStylistPair"("stylist_account_id", "last_message_at" DESC, "id" DESC);

-- Drop replaced indexes only after their successors exist, so query coverage
-- holds for any statement-level failure point within the transaction.
DROP INDEX IF EXISTS "ClientStylistPair_client_user_id_last_message_at_idx";
DROP INDEX IF EXISTS "ClientStylistPair_stylist_account_id_last_message_at_idx";

-- One index serves thread pagination and latest-message LATERAL lookup.
CREATE INDEX "StylistClientMessage_pair_id_created_at_id_idx"
ON "StylistClientMessage"("pair_id", "created_at" DESC, "id" DESC);

-- Covers unread count: pair + opposite sender + created_at cutoff.
CREATE INDEX "StylistClientMessage_pair_id_sender_type_created_at_idx"
ON "StylistClientMessage"("pair_id", "sender_type", "created_at" DESC);

DROP INDEX IF EXISTS "StylistClientMessage_pair_id_created_at_idx";

-- User activity and admin timeline use the same deterministic total order.
-- Keep Prisma's 63-byte generated name exactly; Postgres would otherwise
-- truncate a longer manual name differently and create schema drift.
CREATE INDEX "EventLog_created_by_user_id_event_type_created_at_event_log_idx"
ON "EventLog"("created_by_user_id", "event_type", "created_at" DESC, "event_log_id" DESC);

CREATE INDEX "EventLog_created_by_user_id_created_at_event_log_id_idx"
ON "EventLog"("created_by_user_id", "created_at" DESC, "event_log_id" DESC);

DROP INDEX IF EXISTS "EventLog_created_by_user_id_event_type_created_at_idx";
