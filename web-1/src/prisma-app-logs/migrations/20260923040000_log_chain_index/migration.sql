-- S122: lookup of events from the same request chain (admin log details).
-- Plain CREATE INDEX (no CONCURRENTLY: migrate deploy runs in a transaction); the table is small.
CREATE INDEX "AppLogRecord_event_log_chain_id_idx" ON "AppLogRecord"("event_log_chain_id");
