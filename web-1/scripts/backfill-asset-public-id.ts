/**
 * Backfill kolumny `public_id` (i `avatar_public_id`) z istniejących adresów plików.
 *
 * PO CO: bramka własności pliku (`domain/_shared/guards/cloudinary-asset.guard.ts`) pytała
 * o właściciela, ściągając CAŁĄ kolumnę adresów z trzech tabel — zmierzone 87,1 ms przy
 * 200k wierszy, razy trzy tabele, przy KAŻDYM zapisie zdjęcia. Z wypełnioną kolumną
 * i indeksem: 0,461 ms, płasko.
 *
 * CO JEST TU NAPRAWDĘ WAŻNE — LICZBA WIERSZY NIEROZKŁADALNYCH:
 * `null` NIE znaczy „plik niczyj". Wiersz, z którego nie da się wyprowadzić identyfikatora,
 * zostaje na wolniejszej ścieżce porównania w kodzie i NADAL chroni swój plik — tak działa
 * bramka i tak ma działać (inaczej wraca luka HIGH z 2026-09-09: wiersz zapisany
 * niekanonicznie wypadał z porównania i przestawał chronić cokolwiek).
 * Ta liczba jest więc WYNIKIEM, nie efektem ubocznym: mówi, ile wierszy zostaje na
 * wolniejszej ścieżce i czy `extractPublicIdFromUrl` nie ma dziury. Jeśli rośnie —
 * to sygnał o parserze, a nie zaproszenie do wycięcia sprawdzenia w bramce.
 *
 * Idempotentny: bierze wyłącznie wiersze z `public_id IS NULL`, więc kolejne przebiegi
 * dotykają tylko tego, czego poprzednie nie umiały rozłożyć.
 *
 * URUCHOMIENIE:
 *   dev:        npx tsx scripts/backfill-asset-public-id.ts
 *   produkcja:  npm run production backfill:asset-public-id
 *   podgląd:    dopisz `--dry-run` (nic nie zapisuje, tylko liczy)
 */

import { DB_CLIENT } from '../src/application/db/db.client.js';
import { extractPublicIdFromUrl } from '../src/application/cloudinary/cloudinary-url.utils.js';

const BATCH = 500;
const DRY_RUN = process.argv.includes('--dry-run');

type Stats = { scanned: number; filled: number; unparsed: number };

const emptyStats = (): Stats => ({ scanned: 0, filled: 0, unparsed: 0 });

async function backfillGalleryRecords(): Promise<Stats> {
  const stats = emptyStats();
  let cursor: string | null = null;
  for (;;) {
    const rows = await DB_CLIENT.use.galleryRecord.findMany({
      // DECISION (nie usuwaj tego komentarza) — KEYSET W `where`, NIE `cursor`+`skip: 1`:
      // stronicowanie musi iść PO KLUCZU, bo wiersz-kursor OPUSZCZA zbiór, gdy tylko
      // zostanie wypełniony. Prisma zamienia `cursor` na `id >= <wartość>`, więc przy
      // `public_id: null` pierwszym wierszem następnej porcji jest już KOLEJNY
      // nierozłożony wiersz — a `skip: 1` właśnie jego zjadał. Efekt: przy każdej
      // porcji, której ostatni wiersz rozłożył się poprawnie (czyli praktycznie
      // każdej), jeden wiersz nie był ani wypełniony, ani policzony, a skrypt i tak
      // drukował „Nierozkładalnych: 0". To jest DOKŁADNIE ta liczba, o której nagłówek
      // tego pliku mówi, że kłamać nie może: raportuje rozmiar wolnej ścieżki bramki
      // własności. `gt` jest odporne na obie sytuacje — wiersz wypełniony i wiersz
      // nierozkładalny tak samo zostają za kursorem.
      where: {
        public_id: null,
        ...(cursor === null ? {} : { gallery_record_id: { gt: cursor } }),
      },
      select: { gallery_record_id: true, asset_url: true },
      orderBy: { gallery_record_id: 'asc' },
      take: BATCH,
    });
    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      stats.scanned += 1;
      const publicId = extractPublicIdFromUrl(row.asset_url);
      if (publicId === null) {
        stats.unparsed += 1;
        continue;
      }
      if (!DRY_RUN) {
        await DB_CLIENT.use.galleryRecord.update({
          where: { gallery_record_id: row.gallery_record_id },
          data: { public_id: publicId },
        });
      }
      stats.filled += 1;
    }
    cursor = rows[rows.length - 1].gallery_record_id;
  }
  return stats;
}

async function backfillVisitPhotos(): Promise<Stats> {
  const stats = emptyStats();
  let cursor: string | null = null;
  for (;;) {
    const rows = await DB_CLIENT.use.visitResultPhoto.findMany({
      // Keyset po kluczu — powód przy backfillGalleryRecords.
      where: {
        public_id: null,
        ...(cursor === null ? {} : { id: { gt: cursor } }),
      },
      select: { id: true, asset_url: true },
      orderBy: { id: 'asc' },
      take: BATCH,
    });
    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      stats.scanned += 1;
      const publicId = extractPublicIdFromUrl(row.asset_url);
      if (publicId === null) {
        stats.unparsed += 1;
        continue;
      }
      if (!DRY_RUN) {
        await DB_CLIENT.use.visitResultPhoto.update({
          where: { id: row.id },
          data: { public_id: publicId },
        });
      }
      stats.filled += 1;
    }
    cursor = rows[rows.length - 1].id;
  }
  return stats;
}

async function backfillAvatars(): Promise<Stats> {
  const stats = emptyStats();
  let cursor: string | null = null;
  for (;;) {
    const rows = await DB_CLIENT.use.stylistAccount.findMany({
      // Keyset po kluczu — powód przy backfillGalleryRecords.
      where: {
        avatar_url: { not: null },
        avatar_public_id: null,
        ...(cursor === null ? {} : { account_id: { gt: cursor } }),
      },
      select: { account_id: true, avatar_url: true },
      orderBy: { account_id: 'asc' },
      take: BATCH,
    });
    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      stats.scanned += 1;
      const publicId =
        row.avatar_url === null ? null : extractPublicIdFromUrl(row.avatar_url);
      if (publicId === null) {
        stats.unparsed += 1;
        continue;
      }
      if (!DRY_RUN) {
        await DB_CLIENT.use.stylistAccount.update({
          where: { account_id: row.account_id },
          data: { avatar_public_id: publicId },
        });
      }
      stats.filled += 1;
    }
    cursor = rows[rows.length - 1].account_id;
  }
  return stats;
}

const line = (label: string, s: Stats): string =>
  `  ${label.padEnd(22)} przejrzane ${String(s.scanned).padStart(6)} · wypełnione ${String(s.filled).padStart(6)} · NIEROZKŁADALNE ${String(s.unparsed).padStart(5)}`;

async function main(): Promise<void> {
  console.log(
    `\nBackfill public_id${DRY_RUN ? ' — DRY RUN (nic nie zapisuję)' : ''}\n`
  );

  const gallery = await backfillGalleryRecords();
  console.log(line('GalleryRecord', gallery));
  const photos = await backfillVisitPhotos();
  console.log(line('VisitResultPhoto', photos));
  const avatars = await backfillAvatars();
  console.log(line('StylistAccount.avatar', avatars));

  const unparsed = gallery.unparsed + photos.unparsed + avatars.unparsed;
  const filled = gallery.filled + photos.filled + avatars.filled;

  console.log(`\n  Wypełnionych łącznie: ${filled}`);
  if (unparsed === 0) {
    console.log(
      '  Nierozkładalnych: 0 — każdy wiersz jedzie teraz szybką ścieżką po indeksie.\n'
    );
  } else {
    console.log(
      `  Nierozkładalnych: ${unparsed} — TYLE wierszy zostaje na wolniejszej ścieżce\n` +
        '  porównania w kodzie. To jest poprawne i bezpieczne (dalej chronią swoje pliki),\n' +
        '  ale jeśli ta liczba rośnie, sprawdź `extractPublicIdFromUrl` — NIE usuwaj\n' +
        '  ścieżki B w cloudinary-asset.guard.ts.\n'
    );
  }
}

main()
  .catch(error => {
    console.error('Backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void DB_CLIENT.use.$disconnect();
  });
