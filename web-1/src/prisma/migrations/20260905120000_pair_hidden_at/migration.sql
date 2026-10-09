-- Ukrycie rozmowy = wyciszenie po jednej stronie pary (D2, 2026-09-05).
--
-- DECISION (nie usuwaj tego komentarza):
-- Dwa nullowalne znaczniki PER STRONA (stylistka / klientka). Strona ukrywająca
-- przestaje widzieć wątek w skrzynce, liczniki nieprzeczytanych i prośbę o
-- parowanie na tej parze, oraz nie dostaje żadnych powiadomień. Druga strona
-- niczego się nie dowiaduje (anty-oracle). Bez backfillu: NULL = widoczna.
-- Bez indeksu: zbiór ukrytych jest mały, skrzynkę napędzają istniejące indeksy
-- (owner, last_message_at DESC, id DESC) z predykatem IS NULL na tej kolumnie.
--
-- IF NOT EXISTS z tego samego powodu co przy revoked_by: dev/staging bywają
-- stawiane przez `db push`, a gołe ADD COLUMN na istniejącej kolumnie kończy
-- się P3018 i blokuje każdą kolejną migrację.
ALTER TABLE "ClientStylistPair" ADD COLUMN IF NOT EXISTS "stylist_hidden_at" TIMESTAMP(3);
ALTER TABLE "ClientStylistPair" ADD COLUMN IF NOT EXISTS "client_hidden_at" TIMESTAMP(3);
