// cloudinary-asset.guard.ts
// Wspólna bramka własności pliku w chmurze dla KAŻDEJ powierzchni, która
// przyjmuje `asset_url` od klienta. Dziś są trzy i wszystkie tu wchodzą:
// praca w galerii (gallery-create.operation), zdjęcie efektu wizyty
// (visit-result-photo.operations), zdjęcie profilowe (account-avatar.operations).
// Lista jest wyliczona świadomie: nagłówek mówił „KAŻDEJ", a wymieniał dwie, więc
// galeria — powierzchnia NAJWIĘKSZA i źródło adresów dla pozostałych — wypadła
// z niego niezauważona. Dokładasz czwartą powierzchnię z `*_url` od klienta?
// Wołasz stąd I dopisujesz się do tej listy (strażnik: tests/audit/asset-ownership-gate.sh).
//
// DECISION (nie usuwaj tego komentarza) — DLACZEGO TO MIESZKA W `_shared`:
// bramka powstała przy zdjęciach wizyt jako funkcja prywatna. Zdjęcie profilowe
// stylistki (2026-09-09) jest drugą powierzchnią o DOKŁADNIE tym samym wektorze
// (upload z przeglądarki wprost do chmury → backend dostaje sam adres → z adresu
// liczy się `public_id`, którym kasuje się plik), a rozgałęzienie kontroli
// bezpieczeństwa na dwie kopie kończy się tym, że jedna dostaje poprawkę, a druga
// nie. Kopiowanie tego akurat kodu byłoby więc droższe niż jego wyniesienie.

import { DB_CLIENT } from '@app/db/db.client';
import {
  assetUrlReferencesPublicId,
  extractPublicIdFromUrl,
} from '@app/cloudinary/cloudinary-url.utils';

/**
 * Czy plik spod tego `asset_url` jest już zajęty przez INNE konto?
 *
 * DECISION (nie usuwaj tego komentarza) — PORÓWNANIE PO `public_id`, NIE PO URL:
 * pierwsza wersja tej bramki dopasowywała literał URL-a i dawała się obejść, bo
 * kasowanie w chmurze działa na `public_id` wyprowadzonym z URL-a, a jeden
 * `public_id` ma wiele zapisów: `…/victim.jpg?x=1` i `…/upload/w_1/v123/victim.jpg`
 * wskazują ten sam plik co `…/upload/v123/victim.jpg`. Wystarczyło podać wariant,
 * żeby przejść obok bramki i skasować cudze zdjęcie.
 * Rozstrzyga równość identyfikatora wyprowadzonego z OBU stron (napastnika i
 * wiersza), nigdy dopasowanie literału — patrz DECISION przy zapytaniu niżej.
 * URL bez `public_id` odrzucamy: skoro nie umiemy powiedzieć, na co wskazuje,
 * nie umiemy też stwierdzić, że nie jest cudzy (fail-closed).
 */
export type AssetOwnershipVerdict = 'OWN' | 'FOREIGN' | 'UNRECOGNIZED_URL';

export const findForeignAssetOwner = async (
  assetUrl: string,
  stylistAccountId: string
): Promise<AssetOwnershipVerdict> => {
  const publicId = extractPublicIdFromUrl(assetUrl);
  if (publicId === null) {
    // Fail-closed ZOSTAJE (nie umiemy powiedzieć, na co wskazuje, więc nie
    // umiemy stwierdzić, że nie jest cudzy), ale rozróżniamy przyczynę:
    // zarzucanie stylistce przywłaszczenia cudzego pliku, gdy realnie podała
    // adres w nieobsługiwanym formacie, wysyłało diagnostykę w złą stronę.
    return 'UNRECOGNIZED_URL';
  }

  // DECISION (nie usuwaj tego komentarza) — DWIE ŚCIEŻKI, I OBIE SĄ KONIECZNE (S113):
  //
  // ŚCIEŻKA A (indeks): `public_id` jest wypełniany przy zapisie, więc pytanie „czy ktoś
  // inny ma już ten plik" to zwykły odczyt po indeksie. Wcześniej ta bramka ściągała CAŁĄ
  // kolumnę adresów z trzech tabel i rozstrzygała w kodzie — zmierzone 87,1 ms przy 200k
  // wierszy, razy trzy tabele, PRZY KAŻDYM zapisie zdjęcia. Po indeksie: 0,461 ms, płasko.
  //
  // ŚCIEŻKA B (wiersze z `public_id IS NULL`) NIE JEST OPCJONALNA i nie wolno jej wyciąć
  // „bo backfill przeszedł". Reguła tej bramki brzmi: wiersz, z którego NIE DA SIĘ
  // wyprowadzić identyfikatora, liczy się jako CUDZY. Takie wiersze mają po backfillu
  // `NULL`, więc ścieżka A ICH NIE WIDZI — i sam indeks odtworzyłby dokładnie tę lukę
  // HIGH, którą zamknięto 2026-09-09: wiersz ofiary zapisany niekanonicznie wypadał
  // z porównania, bramka „poprawnie" porównywała PUSTY ZBIÓR i orzekała OWN, a napastnik
  // ustawiał sobie kanoniczny adres cudzego pliku. Wydajność nie jest powodem, żeby
  // wpuścić ją z powrotem.
  //
  // Koszt ścieżki B jest proporcjonalny do liczby wierszy NIEROZKŁADALNYCH, nie do
  // rozmiaru tabel — a tę liczbę raportuje backfill (`scripts/backfill-asset-public-id.ts`).
  // Jeśli urośnie, to jest sygnał o dziurze w `extractPublicIdFromUrl`, a nie zaproszenie
  // do usunięcia sprawdzenia.
  const [
    galleryIndexed,
    photoIndexed,
    avatarIndexed,
    galleryUnparsed,
    photoUnparsed,
    avatarUnparsed,
  ] = await Promise.all([
    DB_CLIENT.use.galleryRecord.findFirst({
      where: {
        created_by_account_id: { not: stylistAccountId },
        public_id: publicId,
      },
      select: { gallery_record_id: true },
    }),
    DB_CLIENT.use.visitResultPhoto.findFirst({
      where: {
        stylist_account_id: { not: stylistAccountId },
        public_id: publicId,
      },
      select: { id: true },
    }),
    DB_CLIENT.use.stylistAccount.findFirst({
      where: {
        account_id: { not: stylistAccountId },
        avatar_public_id: publicId,
      },
      select: { account_id: true },
    }),
    DB_CLIENT.use.galleryRecord.findMany({
      where: {
        created_by_account_id: { not: stylistAccountId },
        public_id: null,
      },
      select: { asset_url: true },
    }),
    DB_CLIENT.use.visitResultPhoto.findMany({
      where: {
        stylist_account_id: { not: stylistAccountId },
        public_id: null,
      },
      select: { asset_url: true },
    }),
    // Zdjęcie profilowe jest trzecim miejscem, w którym ŻYJE adres pliku, więc musi
    // chronić tak samo jak dwa pozostałe — inaczej cudzy avatar byłby jedynym plikiem
    // w systemie, który wolno przywłaszczyć.
    DB_CLIENT.use.stylistAccount.findMany({
      where: {
        account_id: { not: stylistAccountId },
        avatar_url: { not: null },
        avatar_public_id: null,
      },
      select: { avatar_url: true },
    }),
  ]);

  if (
    galleryIndexed !== null ||
    photoIndexed !== null ||
    avatarIndexed !== null
  ) {
    return 'FOREIGN';
  }

  // DECISION (nie usuwaj tego komentarza) — WIERSZ NIEROZPOZNANY LICZY SIĘ JAKO CUDZY:
  // skoro adres takiego wiersza ZAWIERA nasz identyfikator, a my nie umiemy go rozłożyć,
  // nie umiemy też orzec, że wskazuje co innego. Niepewność rozstrzygamy na korzyść
  // właściciela pliku — reguła mieszka w `assetUrlReferencesPublicId`, wspólnie
  // z kontrolą referencji przy kasowaniu, żeby nie rozjechały się po raz kolejny.
  const unparsedUrls = [
    ...galleryUnparsed.map(row => row.asset_url),
    ...photoUnparsed.map(row => row.asset_url),
    ...avatarUnparsed
      .map(row => row.avatar_url)
      .filter((url): url is string => url !== null),
  ];

  const isForeign = unparsedUrls.some(url =>
    assetUrlReferencesPublicId(url, publicId)
  );
  return isForeign ? 'FOREIGN' : 'OWN';
};
