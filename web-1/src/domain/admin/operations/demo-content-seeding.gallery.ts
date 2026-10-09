// asset-ownership-allow: wystawa demo składa adresy z WŁASNEGO banku zdjęć
// (demo-content-seeding.bank.ts, nazwa spoza banku rzuca), nigdy z ciała żądania —
// nie ma tu wejścia klienta, które bramka własności miałaby sprawdzać. Dodatkowo
// seed nie uruchamia się poza dev/stagingiem (demo-content-seeding.guard.ts).
import { DB_CLIENT } from '@app/db/db.client';
import { extractPublicIdFromUrl } from '@app/cloudinary/cloudinary-url.utils';
import { TIME } from '@kernel/application/constants.config';
import type { DemoPhoto } from './demo-content-seeding.photos';
import { resolveDemoAssetUrl } from './demo-content-seeding.config';
import { DEMO_BANK_ASSET_URLS } from './demo-content-seeding.bank';
import { deleteGalleryRecordsById_IO } from './demo-content-seeding.cleanup';

/**
 * Bulk galeria dla jednej stylistki (dowolny bank zdjęć demo) — find-or-create
 * PO ASSET_URL (znormalizowanym), zero upsertu w pętli (AGENTS.md „PRISMA -
 * PERFORMANCE"): fetch-existing → createMany dla
 * brakujących wierszy, potem JEDEN refetch buduje mapę asset_url→id używaną
 * dalej przez sesje/wizyty/lajki tej stylistki. Junction-tabele (kolory/cechy)
 * oraz `nail_length` są UZGADNIANE dla wszystkich rekordów ze specyfikacji, nie
 * tylko dla nowo dodanych — patrz DECISION niżej.
 *
 * UWAGA na zrodlo idempotencji: daje ja WYLACZNIE powyzszy diff w pamieci
 * (`existingUrls`), a NIE flaga `skipDuplicates` przy GalleryRecord — ten model
 * nie ma zadnego @@unique, na ktorym baza moglaby duplikat rozpoznac, wiec flaga
 * jest tam bez znaczenia. Dwa rownolegle seedy (boot dev + reczne db:seed:demo)
 * przeszlyby oba przez ten sam diff i wstawily komplet dwa razy. Przy tabelach
 * zlaczen (`galleryRecordColor`/`galleryRecordTrait`) flaga dziala naprawde,
 * bo tam @@unique istnieje.
 *
 * DECISION (nie usuwaj tego komentarza) — ROZSTRZYGNIETE, NIE WRACAC:
 * Naprawa „dodajmy @@unique" zostala ROZWAZONA I ODRZUCONA (S121, 2026-09-16).
 * Zadne z tych dwoch modeli nie ma naturalnego klucza: dla VisitRecord para
 * (stylistka, klientka, data) jest legalnie powtarzalna (dwie wizyty tego samego
 * dnia to poprawny przypadek, nie duplikat), a dla GalleryRecord jedynym kandydatem
 * jest `public_id`, ktory jest CELOWO nieunikalny (SCHEMA_DECISIONS#asset-public-id).
 * Do tego seed jest DEVELOPMENT-only i fail-closed, wiec wyscig nigdy nie dotyka
 * produkcji — a ograniczenie w schemacie to kontrakt PRODUKCYJNY plus migracja na
 * Renderze. Pelne uzasadnienie i opis wlasciwej naprawy (serializacja seeda, nie
 * kontrakt na tabeli) -> docs/DOMAIN/SCHEMA_DECISIONS.md#galleryrecord-visitrecord-bez-unique
 */
export const seedStylistGallery_IO = async ({
  stylistAccountId,
  photos,
  pinnedAssetUrls,
  colorByName,
  traitByName,
  now,
  ageOffsetDays = 0,
}: {
  stylistAccountId: string;
  photos: readonly DemoPhoto[];
  pinnedAssetUrls: readonly string[];
  colorByName: Map<string, string>;
  traitByName: Map<string, string>;
  now: Date;
  /** Postarza całą galerię o N dni (nowe konta nie wypychają wystawy z góry feedu). */
  ageOffsetDays?: number;
}): Promise<{ galleryIdByAssetUrl: Map<string, string>; created: number }> => {
  const normalizedPhotos = photos.map((photo, index) => ({
    ...photo,
    asset_url: resolveDemoAssetUrl(photo.asset_url),
    index,
  }));

  const existing = await DB_CLIENT.use.galleryRecord.findMany({
    where: { created_by_account_id: stylistAccountId },
    select: { gallery_record_id: true, asset_url: true },
  });

  // Praca przeniesiona do innej stylistki (albo wycofana z jej zestawu) musi
  // zniknąć z tego konta, inaczej stan bazy rozjeżdża się z czystym seedem przy
  // każdej zmianie przydziału. Kasujemy WYŁĄCZNIE zdjęcia z banku demo —
  // ręczne uploady z QA na koncie demo zostają nietknięte.
  const specUrls = new Set(normalizedPhotos.map(p => p.asset_url));
  const stale = existing.filter(
    r => DEMO_BANK_ASSET_URLS.has(r.asset_url) && !specUrls.has(r.asset_url)
  );
  if (stale.length > 0) {
    await deleteGalleryRecordsById_IO(stale.map(r => r.gallery_record_id));
  }

  const existingUrls = new Set(
    existing.filter(r => !stale.includes(r)).map(r => r.asset_url)
  );

  const missing = normalizedPhotos.filter(p => !existingUrls.has(p.asset_url));

  if (missing.length > 0) {
    await DB_CLIENT.use.galleryRecord.createMany({
      data: missing.map(p => ({
        created_by_account_id: stylistAccountId,
        asset_url: p.asset_url,
        public_id: extractPublicIdFromUrl(p.asset_url),
        nail_length: p.nail_length,
        is_pinned: false,
        // Staggerowane created_at: zdjęcie o wyższym indeksie w banku jest
        // "starsze" o 1.5 dnia, żeby porządek i meta ("ostatnia wczoraj")
        // wyglądały naturalnie zamiast identycznego timestampu z jednej transakcji.
        created_at: new Date(
          now.getTime() - (ageOffsetDays + p.index * 1.5) * TIME.MS_PER_DAY
        ),
      })),
      skipDuplicates: true,
    });
  }

  const allRecords = await DB_CLIENT.use.galleryRecord.findMany({
    where: { created_by_account_id: stylistAccountId },
    select: { gallery_record_id: true, asset_url: true },
  });
  // Mapa obejmuje WYŁĄCZNIE zdjęcia z banku demo. Konto demo bywa używane do
  // ręcznego QA uploadu, a jego galeria zbiera wtedy pliki testowe; sesje,
  // wizyty i lajki rotują po tej mapie, więc bez filtra wystawa pokazywała
  // „sample-crop" jako zdjęcie efektu wizyty (S111).
  const bankUrls = new Set(normalizedPhotos.map(p => p.asset_url));
  const galleryIdByAssetUrl = new Map(
    allRecords
      .filter(r => bankUrls.has(r.asset_url))
      .map(r => [r.asset_url, r.gallery_record_id])
  );

  // DECISION (nie usuwaj tego komentarza) — UZGADNIAMY WSZYSTKIE WIERSZE, NIE TYLKO NOWE:
  // kolory, cechy i dlugosc paznokcia byly zapisywane WYLACZNIE dla rekordow wlasnie
  // utworzonych, wiec poprawka metadanych w banku NIGDY nie docierala do bazy, ktora
  // seed juz raz obsluzyla. Wystawa pokazywala wczorajsze tagi, a filtr koloru klamal —
  // i to na dev-ie oraz stagingu, czyli dokladnie tam, gdzie powstaja zrzuty do glosowan
  // nad UI. Reszta seeda zbiega sie do czystego stanu (kasowanie wycofanych plikow,
  // kasowanie prac przeniesionych, ponowne przypinanie), wiec ta galaz byla wyjatkiem
  // od jego wlasnego kontraktu. Tabele zlaczen sa male (kilkaset wierszy), a oba maja
  // @@unique([gallery_record_id, *_id]), wiec „skasuj i odtworz" jest tanie i dokladne.
  const specRecordIds = normalizedPhotos
    .map(p => galleryIdByAssetUrl.get(p.asset_url))
    .filter((id): id is string => id !== undefined);

  if (specRecordIds.length > 0) {
    const colorRows: { gallery_record_id: string; color_id: string }[] = [];
    const traitRows: { gallery_record_id: string; trait_id: string }[] = [];
    for (const p of normalizedPhotos) {
      const recordId = galleryIdByAssetUrl.get(p.asset_url);
      if (!recordId) {
        continue;
      }
      for (const colorName of p.colors) {
        const colorId = colorByName.get(colorName);
        // Nazwa spoza slownika RZUCA, tak samo jak nazwa pliku spoza banku
        // (demo-content-seeding.bank.ts): literowka w danych ma wybuchnac, a nie
        // po cichu zostawic zdjecie bez tagu, ktorego nikt juz nie szuka.
        if (colorId === undefined) {
          throw new Error(
            `Demo seed: kolor "${colorName}" (${p.asset_url}) nie istnieje w slowniku kolorow`
          );
        }
        colorRows.push({ gallery_record_id: recordId, color_id: colorId });
      }
      for (const traitName of p.traits) {
        const traitId = traitByName.get(traitName);
        if (traitId === undefined) {
          throw new Error(
            `Demo seed: cecha "${traitName}" (${p.asset_url}) nie istnieje w slowniku cech`
          );
        }
        traitRows.push({ gallery_record_id: recordId, trait_id: traitId });
      }
    }

    // Najpierw zdejmujemy to, czego w specyfikacji juz nie ma (inaczej tag usuniety
    // z banku zostawalby na zdjeciu na zawsze), potem dokladamy komplet.
    await DB_CLIENT.use.galleryRecordColor.deleteMany({
      where: { gallery_record_id: { in: specRecordIds } },
    });
    await DB_CLIENT.use.galleryRecordTrait.deleteMany({
      where: { gallery_record_id: { in: specRecordIds } },
    });
    if (colorRows.length > 0) {
      await DB_CLIENT.use.galleryRecordColor.createMany({
        data: colorRows,
        skipDuplicates: true,
      });
    }
    if (traitRows.length > 0) {
      await DB_CLIENT.use.galleryRecordTrait.createMany({
        data: traitRows,
        skipDuplicates: true,
      });
    }

    // Dlugosc paznokcia rowniez byla pisana tylko przy tworzeniu wiersza. Jedno
    // `updateMany` na grupe (dlugosci sa cztery), a nie zapis na rekord.
    const idsByNailLength = new Map<DemoPhoto['nail_length'], string[]>();
    for (const p of normalizedPhotos) {
      const recordId = galleryIdByAssetUrl.get(p.asset_url);
      if (recordId === undefined) {
        continue;
      }
      const group = idsByNailLength.get(p.nail_length);
      if (group === undefined) {
        idsByNailLength.set(p.nail_length, [recordId]);
      } else {
        group.push(recordId);
      }
    }
    for (const [nailLength, ids] of idsByNailLength) {
      await DB_CLIENT.use.galleryRecord.updateMany({
        where: {
          gallery_record_id: { in: ids },
          NOT: { nail_length: nailLength },
        },
        data: { nail_length: nailLength },
      });
    }
  }

  const normalizedPinned = new Set(
    pinnedAssetUrls.map(url => resolveDemoAssetUrl(url))
  );
  const pinnedIds = [...galleryIdByAssetUrl.entries()]
    .filter(([url]) => normalizedPinned.has(url))
    .map(([, id]) => id);

  if (pinnedIds.length > 0) {
    await DB_CLIENT.use.galleryRecord.updateMany({
      where: {
        created_by_account_id: stylistAccountId,
        gallery_record_id: { in: pinnedIds },
        is_pinned: false,
      },
      data: { is_pinned: true },
    });
  }
  await DB_CLIENT.use.galleryRecord.updateMany({
    where: {
      created_by_account_id: stylistAccountId,
      gallery_record_id: { notIn: pinnedIds },
      is_pinned: true,
    },
    data: { is_pinned: false },
  });

  return { galleryIdByAssetUrl, created: missing.length };
};
