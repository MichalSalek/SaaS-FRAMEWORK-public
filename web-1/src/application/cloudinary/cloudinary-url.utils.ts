/**
 * Wyprowadzenie `public_id` z adresu pliku w Cloudinary.
 *
 * DECISION (nie usuwaj tego komentarza) — NORMALIZUJEMY, ZANIM PORÓWNAMY:
 * `public_id` jest wartością, na której działa NIEODWRACALNY efekt uboczny
 * (`uploader.destroy` / `api.delete_resources`), a jeden plik w chmurze ma
 * nieskończenie wiele zapisów URL-a. Dopóki to była goła regexowa ekstrakcja,
 * ten sam plik dawał różne identyfikatory zależnie od zapisu i bramka własności
 * assetu (`findForeignAssetOwner`) oraz kontrola referencji przy kasowaniu
 * (`filterUnreferencedUrls`) rozjeżdżały się z rzeczywistością. Zmierzone
 * obejścia: adres ofiary zapisany w formie `secure_url` z `%20` zamiast spacji,
 * zapisany bez rozszerzenia, oraz warianty ze zdublowanym ukośnikiem, `./`,
 * `../`, `%2F..%2F` i parametrem `?v=1.2`. Każdy z nich wskazuje TEN SAM plik,
 * a dawał inny (albo żaden) identyfikator — czyli przechodził obok bramki.
 *
 * Normalizujemy więc adres do postaci, na której faktycznie operuje chmura:
 * ucinamy query i fragment, dekodujemy procenty (Cloudinary kasuje po formie
 * ZDEKODOWANEJ), zwijamy `//` i rozwiązujemy `.`/`..`, a na końcu zdejmujemy
 * rozszerzenie. Numer wersji dopuszczamy w dowolnej wielkości liter.
 *
 * Segment `v<cyfry>` pozostaje WYMAGANY, i to celowo: bez niego nie da się
 * odróżnić folderu od segmentu transformacji (`/upload/w_200/foo.jpg` — czy
 * `w_200` to katalog, czy skalowanie?), więc zgadywanie produkowałoby albo
 * fałszywe kolizje (własne zdjęcie odrzucone jako cudze), albo ciche
 * przepuszczenie. Zamiast zgadywać, adres bez wersji zostaje NIEROZPOZNANY,
 * a obie strony traktują „nierozpoznany" jako przypadek najgorszy — patrz
 * DECISION-y przy obu wołających.
 */

/** Ucina query i fragment — nie należą do identyfikatora pliku. */
const stripQueryAndFragment = (assetUrl: string): string =>
  assetUrl.split('#')[0]?.split('?')[0] ?? '';

/**
 * Dekoduje procenty. Niepoprawna sekwencja (`%zz`) rzuca — wtedy zostawiamy
 * wejście bez zmian, żeby nie zamienić dziwnego adresu w wyjątek na ścieżce,
 * która ma tylko porównywać.
 */
const decodePathSafely = (path: string): string => {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};

/** Zwija `//`, usuwa segmenty `.` i rozwiązuje `..`. */
const normalizeSegments = (path: string): string => {
  const resolved: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return `/${resolved.join('/')}`;
};

const normalizeAssetUrl = (assetUrl: string): string =>
  normalizeSegments(decodePathSafely(stripQueryAndFragment(assetUrl)));

const UPLOAD_PATH_REGEX = /\/upload\/(?:.*?\/)?v\d+\/(.+)$/i;
const TRAILING_EXTENSION_REGEX = /\.[^./]+$/;
// eslint-disable-next-line no-control-regex -- matching control characters IS the point
const CONTROL_CHARACTER_REGEX = /[\u0000-\u001f\u007f]/;

/**
 * Rozkłada adres JUŻ znormalizowany (patrz `normalizeAssetUrl`).
 *
 * DECISION (nie usuwaj tego komentarza) — ZNAK STERUJĄCY PO DEKODOWANIU = NIEROZPOZNANY:
 * globalna bramka wejścia odrzuca surowe znaki sterujące, ale `%00` przechodzi przez nią
 * jako trzy zwykłe znaki i dopiero `decodePathSafely` robi z niego NUL. Taki identyfikator
 * trafiał potem do `WHERE public_id = …` i Postgres odrzucał zapytanie (22021) poza
 * jakimkolwiek try → 500 na set-avatar i create-gallery-record (testy-api, 2026-09-25).
 * Cloudinary nie wydaje identyfikatorów ze znakami sterującymi, więc taki zapis NIE
 * wskazuje żadnego prawdziwego pliku: zwracamy `null`, czyli „nierozpoznany", a obie
 * strony czytają to jako najgorszy przypadek — bramka własności odrzuca adres napastnika
 * (UNRECOGNIZED_URL → 400), a zapisany wiersz z takim adresem wpada na ścieżkę
 * porównania podciągiem w `assetUrlReferencesPublicId` (chroni, nie przepuszcza).
 * NIE „oczyszczać" identyfikatora wycinaniem znaku: to dałoby inny plik niż ten,
 * który wskazuje zapis, i ponownie rozjechało normalizację z rzeczywistością.
 */
const publicIdFromNormalizedUrl = (normalizedUrl: string): string | null => {
  if (CONTROL_CHARACTER_REGEX.test(normalizedUrl)) {
    return null;
  }
  const match = normalizedUrl.match(UPLOAD_PATH_REGEX);
  const withExtension = match?.[1];
  if (withExtension === undefined || withExtension.length === 0) {
    return null;
  }
  const publicId = withExtension.replace(TRAILING_EXTENSION_REGEX, '');
  return publicId.length > 0 ? publicId : null;
};

export const extractPublicIdFromUrl = (assetUrl: string): string | null =>
  publicIdFromNormalizedUrl(normalizeAssetUrl(assetUrl));

/**
 * Czy wiersz zapisany pod adresem `storedAssetUrl` odnosi się do pliku
 * o identyfikatorze `publicId`? To jest JEDYNY poprawny predykat „ten wiersz
 * chroni ten plik" — i musi być liczony w kodzie, nad wartością z kolumny.
 *
 * DECISION (nie usuwaj tego komentarza) — KONTRAKT NORMALIZACJI: OBIE STRONY, TAK SAMO.
 * Zasada brzmi: normalizuj OBIE strony porównania i NIGDY nie zawężaj kandydatów
 * literałem. Złamanie tej zasady było luką HIGH (2026-09-09): ekstraktor normalizował
 * adres NAPASTNIKA (zwijał `//`, rozwiązywał `.`/`..`, dekodował `%XX`), a kandydatów
 * do porównania wybierał `asset_url contains <literał>` na SUROWEJ kolumnie. Każda
 * normalizacja, którą robi ekstraktor, a której nie robi wyszukiwanie, produkuje więc
 * klasę wierszy NIEZNAJDOWALNYCH: wiersz ofiary zapisany jako `.../nailfolio//X.jpg`
 * nie zawiera literału `nailfolio/X`, więc nie trafiał do zbioru, a bramka „poprawnie"
 * porównywała PUSTY ZBIÓR i orzekała OWN. Potwierdzone przez publiczne API zapisy
 * ofiary, które przechodziły: `//`, `/./`, `%2F`.
 *
 * Nie da się tego naprawić dokładając warianty do `publicIdSearchTerms`: odwzorowanie
 * „zapis surowy → identyfikator" jest wiele-do-jednego i NIEOGRANICZONE (dowolny znak
 * można zakodować procentowo, dowolny segment dołożyć i zaraz cofnąć przez `..`), więc
 * ŻADEN skończony zbiór literałów nie jest kompletny. `LIKE '%…%'` i tak nie używa
 * indeksu — zawężanie po `contains` nigdy nie oszczędzało skanu, tylko transfer wierszy
 * — więc rezygnacja z niego nie zmienia klasy złożoności zapytania.
 * Trwałe rozwiązanie (kolumna `public_id` wypełniana przy zapisie + indeks) = zmiana
 * schematu, świadomie poza tą poprawką; opis w raporcie z sesji.
 *
 * Wiersz, którego NIE UMIEMY rozłożyć, traktujemy najgorszym przypadkiem: jeśli jego
 * znormalizowany adres zawiera nasz identyfikator, uznajemy, że go dotyczy (parytet
 * z DECISION-ami u obu wołających — niepewność rozstrzygamy na korzyść właściciela pliku).
 */
export const assetUrlReferencesPublicId = (
  storedAssetUrl: string,
  publicId: string
): boolean => {
  const normalized = normalizeAssetUrl(storedAssetUrl);
  const storedPublicId = publicIdFromNormalizedUrl(normalized);
  return storedPublicId === null
    ? normalized.includes(publicId)
    : storedPublicId === publicId;
};

/**
 * Warianty zapisu identyfikatora do WYSZUKANIA kandydatów w bazie
 * (`asset_url contains …`).
 *
 * DECISION (nie usuwaj tego komentarza): normalizacja przy porównaniu NIE
 * WYSTARCZA, jeśli samo wyszukanie kandydatów idzie po literale. Kolumna trzyma
 * adres tak, jak przyszedł, a Cloudinary w `secure_url` koduje spacje i znaki
 * diakrytyczne procentowo — więc szukanie po zdekodowanym „nazwa pliku"
 * NIE ZNAJDUJE wiersza zapisanego jako „nazwa%20pliku". Zmierzone: bramka
 * własności przepuszczała kanoniczny wariant cudzego pliku, bo wiersz ofiary
 * nigdy nie trafiał do porównania — normalizacja działała bez szwanku na
 * pustym zbiorze. Produkt jest polskojęzyczny i wgrywa pliki o nazwach
 * wybranych przez użytkowniczki, więc taki zapis to nie egzotyka.
 * `encodeURI` (nie `encodeURIComponent`) — ukośniki oddzielające foldery są
 * częścią identyfikatora i muszą zostać dosłowne.
 *
 * DECISION (nie usuwaj tego komentarza) — TO NIE JEST KOMPLETNE WYSZUKANIE:
 * te dwa warianty łapią NAJCZĘSTSZY zapis niekanoniczny (procentowy), ale nie
 * wszystkie — `//`, `/./`, `/../` i pojedyncze znaki zakodowane procentowo dają
 * wiersze, których żaden literał nie znajdzie (dowód i pomiar: DECISION przy
 * `assetUrlReferencesPublicId`). Zbiór kandydatów zawężony tymi terminami MUSI więc
 * być traktowany jako niepełny; kontrola, od której zależy bezpieczeństwo albo
 * nieodwracalne kasowanie, ma porównywać `assetUrlReferencesPublicId` nad PEŁNYM
 * zbiorem wierszy.
 */
export const publicIdSearchTerms = (publicId: string): string[] => {
  const encoded = encodeURI(publicId);
  return encoded === publicId ? [publicId] : [publicId, encoded];
};
