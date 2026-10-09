// asset-ownership-allow: wystawa demo składa adresy z WŁASNEGO banku zdjęć
// (demo-content-seeding.bank.ts, nazwa spoza banku rzuca), nigdy z ciała żądania —
// nie ma tu wejścia klienta, które bramka własności miałaby sprawdzać. Dodatkowo
// seed nie uruchamia się poza dev/stagingiem (demo-content-seeding.guard.ts).
import { DB_CLIENT } from '@app/db/db.client';

/**
 * Wycofywanie zdjęć z wystawy demo.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Owner wycofał 2026-09-16 dwadzieścia jeden plików po przeglądzie wizualnym.
 * Samo usunięcie ich z banku NIE wystarcza: seed jest find-or-create, więc
 * wiersze zapisane wcześniej zostałyby w bazie na dev i na stagingu na zawsze.
 * Dlatego lista wycofanych plików JEST CZĘŚCIĄ SEEDA i każdy jego run kasuje
 * pasujące wiersze — stan bazy po runie równa się czystemu seedowi. Kasowanie
 * idzie tą samą bramką co reszta seeda (dev/staging, lokalna baza), więc na
 * produkcji nie wykona się nigdy.
 *
 * NIE kasujemy plików z Cloudinary: to osobna decyzja ownera, a wiersze
 * historyczne innych kont mogłyby na nie wskazywać. Kasujemy WYŁĄCZNIE wiersze
 * bazy (galeria kaskadowo zabiera kolory, cechy, lajki i zdjęcia sesji;
 * zgłoszenia moderacyjne mają SetNull, więc trzeba je usunąć jawnie, inaczej
 * zostałyby w kolejce admina jako zgłoszenia „bez zdjęcia").
 */
export const DEMO_REMOVED_PHOTO_NAMES: readonly string[] = Object.freeze([
  'hero-nail-02-red-gold',
  'hero-nail-07-chrome',
  'hero-nail-08-modern-french',
  'nail-10-short-french',
  'nail-11-short-red',
  'nail-12-short-minimal-line',
  'nail-15-short-floral',
  'nail-16-short-dark-editorial',
  'nail-18-medium-modern-french',
  'nail-19-medium-chrome',
  'nail-23-medium-pastel',
  'nail-25-long-chrome',
  'nail-28-long-dark-editorial',
  'nail-29-long-glitter',
  'nail-31-long-red',
  'nail-34-xl-chrome',
  'nail-35-xl-modern-french',
  'nail-36-xl-geometric',
  'nail-37-xl-red',
  'nail-38-xl-glitter',
  'nail-39-xl-floral',
]);

/** Fragment adresu jednoznaczny dla pliku: '/demo-seed/<nazwa>_'. */
const urlFragment = (name: string): string => `/demo-seed/${name}_`;

const REMOVED_URL_FILTERS = DEMO_REMOVED_PHOTO_NAMES.map(name => ({
  contains: urlFragment(name),
}));

/** Kasuje zgłoszenia moderacyjne wskazanych zdjęć, potem same zdjęcia. */
export const deleteGalleryRecordsById_IO = async (
  recordIds: readonly string[]
): Promise<number> => {
  if (recordIds.length === 0) {
    return 0;
  }
  await DB_CLIENT.use.contentReport.deleteMany({
    where: { gallery_record_id: { in: [...recordIds] } },
  });
  const deleted = await DB_CLIENT.use.galleryRecord.deleteMany({
    where: { gallery_record_id: { in: [...recordIds] } },
  });
  return deleted.count;
};

/**
 * Sprząta wiersze wskazujące na wycofane pliki: galerię (z kaskadami),
 * zdjęcia efektu wizyt (osobna tabela, bez FK do galerii) oraz awatary kont.
 */
export const purgeRemovedDemoAssets_IO = async (
  results: string[]
): Promise<void> => {
  const records = await DB_CLIENT.use.galleryRecord.findMany({
    where: { OR: REMOVED_URL_FILTERS.map(f => ({ asset_url: f })) },
    select: { gallery_record_id: true },
  });
  const galleryDeleted = await deleteGalleryRecordsById_IO(
    records.map(r => r.gallery_record_id)
  );

  const visitPhotos = await DB_CLIENT.use.visitResultPhoto.deleteMany({
    where: { OR: REMOVED_URL_FILTERS.map(f => ({ asset_url: f })) },
  });

  const avatars = await DB_CLIENT.use.stylistAccount.updateMany({
    where: { OR: REMOVED_URL_FILTERS.map(f => ({ avatar_url: f })) },
    data: { avatar_url: null, avatar_public_id: null },
  });
  const images = await DB_CLIENT.use.user.updateMany({
    where: { OR: REMOVED_URL_FILTERS.map(f => ({ image: f })) },
    data: { image: null },
  });

  const touched =
    galleryDeleted + visitPhotos.count + avatars.count + images.count;
  if (touched > 0) {
    results.push(
      `Demo removed assets purged (gallery ${galleryDeleted}, visit photos ${visitPhotos.count}, avatars ${avatars.count + images.count})`
    );
  }
};
