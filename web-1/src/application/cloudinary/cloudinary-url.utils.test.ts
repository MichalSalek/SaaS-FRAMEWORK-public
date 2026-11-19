import { describe, expect, it } from 'vitest';
import {
  assetUrlReferencesPublicId,
  extractPublicIdFromUrl,
  publicIdSearchTerms,
} from './cloudinary-url.utils';

/**
 * `public_id` is the value an irreversible cloud file deletion acts on, so
 * these tests pin ONE property: every spelling of a URL that points to the same
 * file must give the same identifier, and a spelling that cannot be parsed must
 * give `null` (callers treat `null` as the worst case, see the DECISIONs at
 * `findForeignAssetOwner` and `filterUnreferencedUrls`).
 *
 * The variants below are bypasses of the asset ownership gate measured at
 * runtime, not invented edge cases.
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
    // Cloudinary deletes by the DECODED form, so `%20` and a space are the same file.
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
      [
        'fetch target with embedded upload route',
        `${BASE}/../../image/fetch/https://evil.example/upload/v123/victim.jpg`,
      ],
      [
        'encoded fetch traversal',
        `${BASE}/%2e%2e/%2e%2e/image/fetch/https://evil.example/upload/v123/victim.jpg`,
      ],
      [
        'foreign URL embedding a Cloudinary upload path',
        `https://evil.example/https://res.cloudinary.com/demo/image/upload/v123/victim.jpg`,
      ],
      ['brak segmentu wersji', `${BASE}/folder/victim.jpg`],
      [
        'brak segmentu upload',
        'https://res.cloudinary.com/demo/image/v1/x.jpg',
      ],
      ['sama wersja bez nazwy', `${BASE}/v1700000000/`],
      ['pusty ciąg', ''],
      ['nie-URL', 'zupełnie co innego'],
      // Decoded, these are NUL / control characters: Postgres rejected such an
      // identifier (22021) outside the try, so the ownership gate ended in a 500.
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
    // The folder is part of the identifier: two files with the same name in
    // different folders are different files.
    expect(extractPublicIdFromUrl(`${BASE}/v1/one/x.jpg`)).not.toBe(
      extractPublicIdFromUrl(`${BASE}/v1/two/x.jpg`)
    );
  });
});

/**
 * Normalizing at COMPARISON time is not enough if candidates are looked up in
 * the database by literal: the column holds the URL as it arrived, and
 * Cloudinary percent-encodes spaces and diacritics. Measured: the victim row
 * never reached the comparison, so the gate let someone else's file through,
 * "correctly" comparing an empty set.
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
    // encodeURI, not encodeURIComponent: `/` separates folders and is part of the
    // identifier, so encoding it would break the lookup.
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
 * NORMALIZATION CONTRACT: both sides of the comparison, the same way.
 *
 * `extractPublicIdFromUrl` normalizes the ATTACKER's URL, so the ownership
 * check must normalize the STORED URL too. While candidates were picked by a
 * literal (`asset_url contains ...`), a victim row stored non-canonically never
 * reached the comparison; the gate compared an empty set and ruled OWN. The
 * variants below are victim spellings confirmed through the public API (the
 * validator only requires the CDN prefix, so each enters the column via a plain
 * POST).
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
      // `nailfolio/X-2` is NOT `nailfolio/X` even though it contains it as a
      // substring: equality of the extracted identifier decides, not `includes`.
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
