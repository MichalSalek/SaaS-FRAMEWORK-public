import { describe, expect, it } from 'vitest';
import {
  assetUrlReferencesPublicId,
  extractPublicIdFromUrl,
  publicIdSearchTerms,
} from './cloudinary-url.utils';

/**
 * `public_id` jest wartością, na której działa nieodwracalne kasowanie pliku
 * w chmurze, więc te testy pilnują JEDNEJ własności: wszystkie zapisy URL-a
 * wskazujące ten sam plik muszą dać ten sam identyfikator, a zapis, którego
 * nie da się rozłożyć, musi dać `null` (wołający traktują `null` jako przypadek
 * najgorszy — patrz DECISION-y przy `findForeignAssetOwner`
 * i `filterUnreferencedUrls`).
 *
 * Warianty poniżej to zmierzone w runtime obejścia bramki własności assetu,
 * nie wymyślone przypadki brzegowe.
 */

const BASE = 'https://res.cloudinary.com/demo/image/upload';
const CANONICAL = `${BASE}/v1700000000/folder/victim.jpg`;

describe('extractPublicIdFromUrl', () => {
  it('rozkłada kanoniczny adres', () => {
    expect(extractPublicIdFromUrl(CANONICAL)).toBe('folder/victim');
  });

  describe('warianty TEGO SAMEGO pliku dają ten sam identyfikator', () => {
    const expected = extractPublicIdFromUrl(CANONICAL);

    it.each([
      ['query string', `${CANONICAL}?x=1`],
      ['podszywający się parametr wersji', `${CANONICAL}?v=1.2`],
      ['fragment', `${CANONICAL}#preview`],
      ['transformacja', `${BASE}/w_200/v1700000000/folder/victim.jpg`],
      [
        'łańcuch transformacji',
        `${BASE}/w_200,h_200/c_fill/v1700000000/folder/victim.jpg`,
      ],
      ['inny numer wersji', `${BASE}/v999/folder/victim.jpg`],
      ['wersja wielkimi literami', `${BASE}/V1700000000/folder/victim.jpg`],
      ['inne rozszerzenie', `${BASE}/v1700000000/folder/victim.png`],
      ['bez rozszerzenia', `${BASE}/v1700000000/folder/victim`],
      ['zdublowany ukośnik', `${BASE}/v1700000000//folder/victim.jpg`],
      ['segment kropkowy', `${BASE}/v1700000000/./folder/victim.jpg`],
      ['segment nadrzędny', `${BASE}/v1700000000/inny/../folder/victim.jpg`],
      ['zakodowany ukośnik', `${BASE}/v1700000000/folder%2Fvictim.jpg`],
    ])('%s', (_label, url) => {
      expect(extractPublicIdFromUrl(url)).toBe(expected);
    });
  });

  it('zrównuje zapis zakodowany procentowo ze znakiem dosłownym', () => {
    // Cloudinary kasuje po formie ZDEKODOWANEJ, więc `%20` i spacja to ten sam plik.
    const encoded = `${BASE}/v1700000000/qa%20enc.jpg`;
    const literal = `${BASE}/v1700000000/qa enc.jpg`;
    expect(extractPublicIdFromUrl(encoded)).toBe('qa enc');
    expect(extractPublicIdFromUrl(literal)).toBe(
      extractPublicIdFromUrl(encoded)
    );
  });

  it('zrównuje polskie znaki diakrytyczne w obu zapisach', () => {
    const encoded = `${BASE}/v1700000000/pazn%C3%B3kcie.jpg`;
    const literal = `${BASE}/v1700000000/paznókcie.jpg`;
    expect(extractPublicIdFromUrl(literal)).toBe(
      extractPublicIdFromUrl(encoded)
    );
  });

  describe('zapisy nierozpoznane dają null (wołający czytają to jako najgorszy przypadek)', () => {
    it.each([
      ['brak segmentu wersji', `${BASE}/folder/victim.jpg`],
      [
        'brak segmentu upload',
        'https://res.cloudinary.com/demo/image/v1/x.jpg',
      ],
      ['sama wersja bez nazwy', `${BASE}/v1700000000/`],
      ['pusty ciąg', ''],
      ['nie-URL', 'zupełnie co innego'],
      // Po dekodowaniu to NUL / znak sterujący — Postgres odrzucał taki
      // identyfikator (22021) poza try, więc bramka własności kończyła się 500.
      ['zakodowany NUL w nazwie', `${BASE}/v1700000000/folder/vic%00tim.jpg`],
      ['zakodowany NUL w folderze', `${BASE}/v1700000000/fo%00lder/x.jpg`],
      ['zakodowany znak nowej linii', `${BASE}/v1700000000/folder/a%0Ab.jpg`],
      ['zakodowany DEL', `${BASE}/v1700000000/folder/a%7Fb.jpg`],
      ['dosłowny znak sterujący', `${BASE}/v1700000000/folder/a\u0001b.jpg`],
    ])('%s', (_label, url) => {
      expect(extractPublicIdFromUrl(url)).toBeNull();
    });
  });

  it('nie myli różnych plików', () => {
    expect(extractPublicIdFromUrl(`${BASE}/v1/a.jpg`)).not.toBe(
      extractPublicIdFromUrl(`${BASE}/v1/b.jpg`)
    );
    // Folder jest częścią identyfikatora — dwa pliki o tej samej nazwie
    // w różnych folderach to różne pliki.
    expect(extractPublicIdFromUrl(`${BASE}/v1/one/x.jpg`)).not.toBe(
      extractPublicIdFromUrl(`${BASE}/v1/two/x.jpg`)
    );
  });
});

/**
 * Normalizacja przy PORÓWNANIU nie wystarcza, jeśli kandydaci są wyszukiwani
 * w bazie po literale: kolumna trzyma adres tak, jak przyszedł, a Cloudinary
 * koduje spacje i znaki diakrytyczne procentowo. Zmierzone: wiersz ofiary nigdy
 * nie trafiał do porównania, więc bramka przepuszczała cudzy plik, „poprawnie"
 * porównując pusty zbiór.
 */
describe('publicIdSearchTerms', () => {
  it('dokłada zapis zakodowany procentowo dla spacji', () => {
    expect(publicIdSearchTerms('qa enc')).toEqual(['qa enc', 'qa%20enc']);
  });

  it('dokłada zapis zakodowany dla znaków diakrytycznych', () => {
    expect(publicIdSearchTerms('paznókcie')).toEqual([
      'paznókcie',
      'pazn%C3%B3kcie',
    ]);
  });

  it('zachowuje ukośniki folderów dosłownie', () => {
    // encodeURI, nie encodeURIComponent — `/` oddziela foldery i jest częścią
    // identyfikatora, więc zakodowanie go rozjechałoby wyszukiwanie.
    expect(publicIdSearchTerms('folder/pod folder/plik')).toEqual([
      'folder/pod folder/plik',
      'folder/pod%20folder/plik',
    ]);
  });

  it('dla identyfikatora bez znaków wymagających kodowania zwraca jeden wariant', () => {
    expect(publicIdSearchTerms('folder/victim')).toEqual(['folder/victim']);
  });
});

/**
 * KONTRAKT NORMALIZACJI — obie strony porównania, tak samo.
 *
 * `extractPublicIdFromUrl` normalizuje adres NAPASTNIKA, więc kontrola własności
 * musi normalizować też adres ZAPISANY. Dopóki kandydatów wybierał literał
 * (`asset_url contains …`), wiersz ofiary zapisany niekanonicznie NIE TRAFIAŁ do
 * porównania — bramka porównywała pusty zbiór i orzekała OWN. Warianty niżej to
 * zapisy ofiary POTWIERDZONE przez publiczne API (walidator wymaga tylko prefiksu
 * CDN-a, więc każdy z nich wchodzi do kolumny zwykłym POST-em).
 */
describe('assetUrlReferencesPublicId', () => {
  const VICTIM_PUBLIC_ID = 'nailfolio/X';

  describe('NIEKANONICZNY zapis ofiary wciąż chroni plik', () => {
    it.each([
      ['zdublowany ukośnik', `${BASE}/v1700000000/nailfolio//X.jpg`],
      ['segment kropkowy', `${BASE}/v1700000000/nailfolio/./X.jpg`],
      ['zakodowany ukośnik', `${BASE}/v1700000000/nailfolio%2FX.jpg`],
      ['segment nadrzędny', `${BASE}/v1700000000/inny/../nailfolio/X.jpg`],
      [
        'zakodowany segment nadrzędny',
        `${BASE}/v1700000000/inny/%2E%2E/nailfolio/X.jpg`,
      ],
      ['zakodowany znak nazwy', `${BASE}/v1700000000/nailfolio/%58.jpg`],
      ['bez rozszerzenia', `${BASE}/v1700000000/nailfolio/X`],
      [
        'prefiks transformacji',
        `${BASE}/w_200,h_200/v1700000000/nailfolio/X.jpg`,
      ],
      ['query string', `${BASE}/v1700000000/nailfolio/X.jpg?x=1`],
      ['fragment', `${BASE}/v1700000000/nailfolio/X.jpg#a`],
      ['inny numer wersji', `${BASE}/v1/nailfolio/X.jpg`],
    ])('%s', (_label, storedUrl) => {
      expect(assetUrlReferencesPublicId(storedUrl, VICTIM_PUBLIC_ID)).toBe(
        true
      );
    });
  });

  it('zapis ofiary ze znakiem sterującym po dekodowaniu chroni (najgorszy przypadek)', () => {
    // Nierozkładalny (null), więc rozstrzyga porównanie podciągiem — wiersz dalej
    // blokuje przywłaszczenie, zamiast wypaść z porównania.
    expect(
      assetUrlReferencesPublicId(
        `${BASE}/v1700000000/nailfolio/X.jpg%00`,
        VICTIM_PUBLIC_ID
      )
    ).toBe(true);
  });

  it('zapis ofiary BEZ wersji chroni, bo nie umiemy go rozłożyć (najgorszy przypadek)', () => {
    // Nierozpoznany wiersz, którego adres zawiera nasz identyfikator, blokuje —
    // niepewność rozstrzygamy na korzyść właściciela pliku.
    expect(
      assetUrlReferencesPublicId(`${BASE}/nailfolio/X.jpg`, VICTIM_PUBLIC_ID)
    ).toBe(true);
  });

  describe('brak fałszywych trafień', () => {
    it('inny plik w tym samym folderze', () => {
      expect(
        assetUrlReferencesPublicId(
          `${BASE}/v1700000000/nailfolio/Y.jpg`,
          VICTIM_PUBLIC_ID
        )
      ).toBe(false);
    });

    it('ten sam plik w innym folderze', () => {
      expect(
        assetUrlReferencesPublicId(
          `${BASE}/v1700000000/inne/X.jpg`,
          VICTIM_PUBLIC_ID
        )
      ).toBe(false);
    });

    it('identyfikator-nadzbiór zostaje przepuszczony', () => {
      // `nailfolio/X-2` NIE jest `nailfolio/X`, mimo że zawiera go jako podciąg —
      // rozstrzyga równość rozłożonego identyfikatora, nie `includes`.
      expect(
        assetUrlReferencesPublicId(
          `${BASE}/v1700000000/nailfolio/X-2.jpg`,
          VICTIM_PUBLIC_ID
        )
      ).toBe(false);
    });

    it('adres spoza chmury nie dotyczy naszego pliku', () => {
      expect(
        assetUrlReferencesPublicId(
          'https://example.com/zupelnie-co-innego.jpg',
          VICTIM_PUBLIC_ID
        )
      ).toBe(false);
    });
  });

  it('symetria: obie strony liczone tą samą normalizacją', () => {
    // Kluczowa własność. Gdy identyfikator napastnika pochodzi z JEDNEGO zapisu,
    // a wiersz ofiary trzyma INNY zapis tego samego pliku, predykat musi trafić
    // w obie strony — inaczej fail-closed po jednej stronie jest fail-OPEN po drugiej.
    const spellings = [
      `${BASE}/v1700000000/nailfolio/X.jpg`,
      `${BASE}/v1700000000/nailfolio//X.jpg`,
      `${BASE}/v1700000000/nailfolio/./X.jpg`,
      `${BASE}/v1700000000/nailfolio%2FX.jpg`,
      `${BASE}/w_200/v1/nailfolio/X`,
    ];
    for (const attacker of spellings) {
      const publicId = extractPublicIdFromUrl(attacker);
      expect(publicId).not.toBeNull();
      for (const stored of spellings) {
        expect(assetUrlReferencesPublicId(stored, publicId ?? '')).toBe(true);
      }
    }
  });
});
