-- Kolumna `public_id` pod bramkę własności pliku w chmurze
-- (patrz DECISION [asset-public-id] w schema.prisma i cloudinary-asset.guard.ts).
--
-- Bramka odpowiada na pytanie „czy ten plik należy już do KOGO INNEGO" i dotąd, żeby
-- odpowiedzieć, ściągała CAŁĄ kolumnę adresów z trzech tabel (zmierzone: 87,1 ms przy
-- 200k wierszy, razy trzy tabele, przy każdym zapisie zdjęcia). Z indeksem: 0,461 ms.
--
-- Migracja jest w pełni ADDYTYWNA: same kolumny NULLABLE i indeksy, zero zmian na
-- istniejących danych. Wypełnienie robi osobny backfill, a bramka do czasu wypełnienia
-- (i po nim, dla wierszy nierozkładalnych) działa starą ścieżką — brak wartości NIGDY
-- nie oznacza „plik niczyj".
--
-- Świadomie `CREATE INDEX`, NIE `CONCURRENTLY`: `prisma migrate deploy` puszcza plik
-- migracji w JEDNEJ transakcji, a `CREATE INDEX CONCURRENTLY` w transakcji nie działa
-- i kończy się `build_failed` na Renderze (lekcja 2026-07-19, dwa niezauważone przez
-- dwa tygodnie build-faile). Przy dzisiejszej liczbie wierszy zwykły CREATE INDEX
-- to pojedyncze milisekundy.

-- AlterTable
ALTER TABLE "GalleryRecord" ADD COLUMN "public_id" TEXT;

-- AlterTable
ALTER TABLE "VisitResultPhoto" ADD COLUMN "public_id" TEXT;

-- AlterTable
ALTER TABLE "StylistAccount" ADD COLUMN "avatar_public_id" TEXT;

-- CreateIndex
CREATE INDEX "GalleryRecord_public_id_idx" ON "GalleryRecord"("public_id");

-- CreateIndex
CREATE INDEX "VisitResultPhoto_public_id_idx" ON "VisitResultPhoto"("public_id");

-- CreateIndex
CREATE INDEX "StylistAccount_avatar_public_id_idx" ON "StylistAccount"("avatar_public_id");
