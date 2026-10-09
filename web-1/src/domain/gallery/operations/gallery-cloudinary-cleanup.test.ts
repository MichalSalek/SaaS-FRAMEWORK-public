/**
 * Sink kasowania plikow w chmurze — test BRAMKI CHMURY, nie normalizacji adresu
 * (te pilnuje `cloudinary-url.utils.test.ts`) i nie bramki referencyjnej.
 *
 * Pinowana wlasnosc: `public_id` do SKASOWANIA wolno wyprowadzic wylacznie
 * z adresu wskazujacego NASZA chmure. Powod jest ten sam, ktory sink opisuje
 * przy bramce referencyjnej — `public_id` liczy sie z samego URL-a — tyle ze
 * w drugiej osi: `UPLOAD_PATH_REGEX` dopasowuje `/upload/.../v<cyfry>/<reszta>`
 * i CALKOWICIE ignoruje segment z nazwa konta, a walidator wejscia sprawdza sam
 * prefiks `res.cloudinary.com/`. Adres obcej chmury dawal wiec identyfikator
 * w NASZEJ przestrzeni nazw (zmierzone w runtime, S121).
 *
 * Test celuje w `delete_resources`: nie „czy funkcja zwrocila blad", tylko
 * CZY DOSZLO DO WYWOLANIA KASOWANIA i z jakimi identyfikatorami.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  cloudName: 'nasza-chmura',
  deleteResources: vi.fn(),
  findMany: vi.fn(),
  avatarFindMany: vi.fn(),
}));

vi.mock('@app/cloudinary/cloudinary.adapter', () => ({
  cloudinary: { api: { delete_resources: h.deleteResources } },
}));
vi.mock('@app/environment/environment.config', () => ({
  ENV_VARS: {
    get CLOUDINARY_CLOUD_NAME() {
      return h.cloudName;
    },
  },
}));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    use: {
      galleryRecord: { findMany: h.findMany },
      visitResultPhoto: { findMany: h.findMany },
      stylistAccount: { findMany: h.avatarFindMany },
    },
  },
}));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));
// Sink odpala prace przez runAfterResponse — w tescie wykonujemy ja natychmiast,
// zeby asercja patrzyla na SKUTEK, a nie na zarejestrowana obietnice.
vi.mock('@app/runtime/run-after-response', () => ({
  runAfterResponse: (fn: () => Promise<void>) => fn(),
}));

import { cleanupCloudinaryAssets } from './gallery-cloudinary-cleanup';

const OURS =
  'https://res.cloudinary.com/nasza-chmura/image/upload/v1700000000/nailfolio/mine.jpg';
const FOREIGN =
  'https://res.cloudinary.com/obca-chmura/image/upload/v1700000000/nailfolio/mine.jpg';

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

describe('cleanupCloudinaryAssets — bramka chmury', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.cloudName = 'nasza-chmura';
    // Zero odniesien w bazie = bramka referencyjna przepuszcza; izolujemy bramke chmury.
    h.findMany.mockResolvedValue([]);
    h.avatarFindMany.mockResolvedValue([]);
    h.deleteResources.mockResolvedValue({ deleted: {} });
  });

  it('kasuje plik z NASZEJ chmury', async () => {
    cleanupCloudinaryAssets([OURS]);
    await flush();

    expect(h.deleteResources).toHaveBeenCalledTimes(1);
    expect(h.deleteResources.mock.calls[0]?.[0]).toEqual(['nailfolio/mine']);
  });

  it('NIE kasuje niczego dla adresu z OBCEJ chmury', async () => {
    cleanupCloudinaryAssets([FOREIGN]);
    await flush();

    expect(h.deleteResources).not.toHaveBeenCalled();
  });

  // Adres obcej chmury o INNYM `public_id` niz nasz. To rozroznienie jest celowe:
  // przy tym samym identyfikatorze oba adresy zwijaja sie do jednego wpisu w mapie,
  // wiec test przechodzilby TAKZE z wycieta bramka — czyli nie pokrywalby klasy,
  // ktora nazywa. (Ta zbieznosc jest zreszta samym sednem luki: obcy adres trafia
  // w NASZA przestrzen nazw.)
  const FOREIGN_OTHER_ID =
    'https://res.cloudinary.com/obca-chmura/image/upload/v1700000000/nailfolio/theirs.jpg';

  it('z mieszanej paczki bierze wylacznie nasza chmure', async () => {
    cleanupCloudinaryAssets([FOREIGN_OTHER_ID, OURS]);
    await flush();

    expect(h.deleteResources).toHaveBeenCalledTimes(1);
    expect(h.deleteResources.mock.calls[0]?.[0]).toEqual(['nailfolio/mine']);
  });

  it('bez skonfigurowanej nazwy chmury nie kasuje nic (fail-closed)', async () => {
    h.cloudName = '';
    cleanupCloudinaryAssets([OURS]);
    await flush();

    expect(h.deleteResources).not.toHaveBeenCalled();
  });
});
