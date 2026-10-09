#!/usr/bin/env bash
# clean-qa-artifacts — sprzątanie artefaktów po testach API/E2E z DEV DB.
#
# PROBLEM (S51 /ui census): testy API zostawiają w dev DB tymczasowe konta
# (temp-qa-*@example.com — 697 szt. na 2026-07-12), sesje inspiracji
# (r3-*/qa-*) i rekordy galerii z chmury `demo` Cloudinary (idor-*, sample.jpg)
# — także NA KONTACH DEMO, przez co demo-wystawa do QA wizualnego pokazuje
# broken kafle i śmieciowe archiwa, a census /ui zgłasza fałszywe findingi.
#
# CO CZYŚCI (wyłącznie udokumentowane klasy):
#   1. users z e-mailem temp-*@example.com  → kaskady zdejmują konta,
#      galerie, pary, sesje i wizyty tych kont (FK ON DELETE CASCADE).
#   2. Osierocone SessionContainer po temp-stylistkach (stylist FK = SET NULL,
#      kasujemy tylko te o nazwach testowych r3-%/qa-%/temp-%/e2e-%).
#   3. SessionContainer o nazwach testowych na KAŻDYM koncie (demo/test).
#   4. GalleryRecord z asset_url w chmurze `demo` Cloudinary (testowy upload;
#      realne assety żyją w chmurze projektowej) + jego dzieci.
#   5. Osierocone SupportThread (user_id bez FK — nie kasuje się kaskadą).
#   6. Testowe Trait/Color po testach API (nazwa z 8-cyfrowym timestampem lub
#      prefiksem QA, np. „QAat 1782408967583") — przeciekały do GLOBALNYCH
#      filtrów explore/stylists (S56 /ui census), psując czytelność listy cech.
#      Realne cechy to polskie nazwy bez cyfr → wzorzec bezpieczny (0 kolizji).
#
# NIE DOTYKA: kont demo-*/test-* (smoke-trio + demo-duo z test-users.config),
# realnych danych, flag, planów. Bezpieczny do odpalenia w dowolnym momencie
# na devie; NIE odpalać na prod (gate na kontener `db` z compose).
#
# UŻYCIE:  npm run db:clean-qa   (web-1)   |   bash scripts/db/clean-qa-artifacts.sh

set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-db}"
DB_USER="${DB_USER:-app_dev}"
DB_NAME="${DB_NAME:-db}"

if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  echo "✗ Kontener '$DB_CONTAINER' nie działa — to narzędzie jest dev-only (compose)." >&2
  exit 1
fi

docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;

-- 1. Tymczasowe konta testów API (kaskady sprzątają dzieci)
WITH del AS (
  DELETE FROM users
  WHERE email LIKE 'temp-%@example.com'
  RETURNING 1
) SELECT format('users temp-*: %s', count(*)) FROM del;

-- 2+3. Sesje inspiracji o nazwach testowych (na dowolnym koncie + orphany)
WITH del AS (
  DELETE FROM "SessionContainer"
  WHERE name LIKE 'r3-%' OR name LIKE 'qa-%'
     OR name LIKE 'temp-%' OR name LIKE 'e2e-%'
  RETURNING 1
) SELECT format('SessionContainer testowe: %s', count(*)) FROM del;

-- 4. Rekordy galerii z testowej chmury `demo` (dzieci ręcznie — brak FK od photo)
WITH victims AS (
  SELECT gallery_record_id FROM "GalleryRecord"
  WHERE asset_url LIKE 'https://res.cloudinary.com/demo/%'
), d1 AS (
  DELETE FROM "SessionContainerPhoto"
  WHERE gallery_record_id IN (SELECT gallery_record_id FROM victims) RETURNING 1
), d2 AS (
  DELETE FROM "GalleryRecord"
  WHERE gallery_record_id IN (SELECT gallery_record_id FROM victims) RETURNING 1
) SELECT format('GalleryRecord demo-cloud: %s (+%s photo-refs)',
    (SELECT count(*) FROM d2), (SELECT count(*) FROM d1));

-- 5. Osierocone wątki supportu (user_id bez FK)
WITH del AS (
  DELETE FROM "SupportThread"
  WHERE user_id NOT IN (SELECT id FROM users)
  RETURNING 1
) SELECT format('SupportThread orphan: %s', count(*)) FROM del;

-- 6. Testowe Trait/Color po testach API (timestamp lub prefiks QA) — przeciekały
--    do GLOBALNYCH filtrów explore/stylists (S56 /ui census). Realne cechy to
--    polskie nazwy bez cyfr; FK-referencje w GalleryRecord* zdejmowane najpierw.
WITH bad AS (
  SELECT id FROM "Trait" WHERE name ~ '[0-9]{8}' OR name ILIKE 'QA%'
), dr AS (
  DELETE FROM "GalleryRecordTrait" WHERE trait_id IN (SELECT id FROM bad) RETURNING 1
), dt AS (
  DELETE FROM "Trait" WHERE id IN (SELECT id FROM bad) RETURNING 1
) SELECT format('Trait testowe: %s (+%s record-refs)',
    (SELECT count(*) FROM dt), (SELECT count(*) FROM dr));

WITH badc AS (
  SELECT id FROM "Color" WHERE name ~ '[0-9]{8}' OR name ILIKE 'QA%'
), drc AS (
  DELETE FROM "GalleryRecordColor" WHERE color_id IN (SELECT id FROM badc) RETURNING 1
), dtc AS (
  DELETE FROM "Color" WHERE id IN (SELECT id FROM badc) RETURNING 1
) SELECT format('Color testowe: %s (+%s record-refs)',
    (SELECT count(*) FROM dtc), (SELECT count(*) FROM drc));

COMMIT;
SQL

echo "✓ QA-artefakty wyczyszczone."
