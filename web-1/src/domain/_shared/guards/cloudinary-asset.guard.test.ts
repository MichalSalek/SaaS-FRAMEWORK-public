/**
 * Bramka własności pliku w chmurze — test WYSZUKANIA kandydatów, nie samej
 * normalizacji (tę pilnuje cloudinary-url.utils.test.ts).
 *
 * Pinowana własność jest jedna i była realną luką HIGH (2026-09-09): wiersz ofiary
 * musi trafić do porównania NIEZALEŻNIE od tego, w jakim zapisie wszedł do kolumny.
 * Dopóki kandydatów wybierał literał (`asset_url contains …`) na surowej kolumnie,
 * niekanoniczny zapis ofiary (`//`, `/./`, `%2F`) był NIEZNAJDOWALNY, więc bramka
 * „poprawnie" porównywała PUSTY ZBIÓR i przepuszczała napastnika z kanonicznym
 * adresem cudzego pliku. Atrapa bazy trzyma więc adresy DOSŁOWNIE (tak jak kolumna)
 * i celowo NIE implementuje żadnego filtrowania — gdyby zapytanie wróciło do
 * zawężania po literale, ten test i tak by je przepuścił, dlatego drugi asercyjny
 * hak sprawdza, że zapytanie nie niesie już żadnego `contains`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { asset_url: string };
type AvatarRow = { avatar_url: string | null };

type WhereClause = Record<string, unknown> & { OR?: Record<string, unknown>[] };

const { db, state } = vi.hoisted(() => {
  const state = {
    gallery: [] as {
      asset_url: string;
      created_by_account_id: string;
      public_id?: string | null;
    }[],
    photos: [] as {
      asset_url: string;
      stylist_account_id: string;
      public_id?: string | null;
    }[],
    avatars: [] as {
      avatar_url: string | null;
      account_id: string;
      avatar_public_id?: string | null;
    }[],
    lastArgs: [] as unknown[],
  };

  /**
   * Wierna atrapa filtrowania po stronie BAZY: adres jest porównywany DOSŁOWNIE,
   * tak jak w kolumnie. Dzięki temu powrót do zawężania `contains` wywala testy
   * zamiast po cichu przechodzić na atrapie, która i tak oddaje wszystko.
   */
  const matches = (
    row: Record<string, unknown>,
    where: WhereClause
  ): boolean => {
    for (const [column, clause] of Object.entries(where)) {
      if (column === 'OR') {
        continue;
      }
      // Kolumna identyfikatora: dopasowanie po WARTOŚCI (ścieżka indeksowa) albo po
      // `null` (ścieżka wierszy nierozkładalnych). Brak pola w atrapie = `null`,
      // dzięki czemu istniejące przypadki „ofiara zapisana niekanonicznie" z miejsca
      // stają się przypadkami NULL-owymi — czyli dokładnie tym, co ma chronić.
      if (column === 'public_id' || column === 'avatar_public_id') {
        const stored = (row[column] ?? null) as string | null;
        if (clause === null) {
          if (stored !== null) {
            return false;
          }
        } else if (typeof clause === 'string') {
          if (stored !== clause) {
            return false;
          }
        }
        continue;
      }
      const guard = clause as { not?: string | null };
      const value = row[column];
      if (guard.not === null ? value === null : value === guard.not) {
        return false;
      }
    }
    if (where.OR === undefined) {
      return true;
    }
    return where.OR.some(alternative =>
      Object.entries(alternative).some(([column, clause]) => {
        const term = (clause as { contains?: string }).contains;
        const value = row[column];
        return (
          term !== undefined &&
          typeof value === 'string' &&
          value.includes(term)
        );
      })
    );
  };

  const findMany =
    <TRow extends Record<string, unknown>, TOut>(
      rows: () => TRow[],
      project: (row: TRow) => TOut
    ) =>
    async (args: { where: WhereClause }): Promise<TOut[]> => {
      state.lastArgs.push(args);
      return rows()
        .filter(row => matches(row, args.where))
        .map(project);
    };

  const findFirst =
    <TRow extends Record<string, unknown>>(rows: () => TRow[]) =>
    async (args: { where: WhereClause }): Promise<TRow | null> => {
      state.lastArgs.push(args);
      return rows().find(row => matches(row, args.where)) ?? null;
    };

  return {
    state,
    db: {
      galleryRecord: {
        findFirst: vi.fn(findFirst(() => state.gallery)),
        findMany: vi.fn(
          findMany(
            () => state.gallery,
            ({ asset_url }): Row => ({ asset_url })
          )
        ),
      },
      visitResultPhoto: {
        findFirst: vi.fn(findFirst(() => state.photos)),
        findMany: vi.fn(
          findMany(
            () => state.photos,
            ({ asset_url }): Row => ({ asset_url })
          )
        ),
      },
      stylistAccount: {
        findFirst: vi.fn(findFirst(() => state.avatars)),
        findMany: vi.fn(
          findMany(
            () => state.avatars,
            ({ avatar_url }): AvatarRow => ({ avatar_url })
          )
        ),
      },
    },
  };
});

vi.mock('@app/db/db.client', () => ({ DB_CLIENT: { use: db } }));

import { findForeignAssetOwner } from './cloudinary-asset.guard';

const BASE = 'https://res.cloudinary.com/demo/image/upload';
const ATTACKER_INPUT = `${BASE}/v1700000000/nailfolio/X.jpg`;
const VICTIM = 'acc_victim';
const ATTACKER = 'acc_attacker';

beforeEach(() => {
  state.gallery = [];
  state.photos = [];
  state.avatars = [];
  state.lastArgs = [];
});

describe('findForeignAssetOwner — zapis ofiary w KAŻDYM wariancie blokuje', () => {
  const victimSpellings: [string, string][] = [
    ['kanoniczny (przypadek kontrolny)', `${BASE}/v1700000000/nailfolio/X.jpg`],
    ['zdublowany ukośnik', `${BASE}/v1700000000/nailfolio//X.jpg`],
    ['segment kropkowy', `${BASE}/v1700000000/nailfolio/./X.jpg`],
    ['zakodowany ukośnik', `${BASE}/v1700000000/nailfolio%2FX.jpg`],
    ['segment nadrzędny', `${BASE}/v1700000000/inny/../nailfolio/X.jpg`],
    ['zakodowany znak nazwy', `${BASE}/v1700000000/nailfolio/%58.jpg`],
    ['bez wersji', `${BASE}/nailfolio/X.jpg`],
    ['bez rozszerzenia', `${BASE}/v1700000000/nailfolio/X`],
    ['prefiks transformacji', `${BASE}/w_200/v1700000000/nailfolio/X.jpg`],
    ['query string', `${BASE}/v1700000000/nailfolio/X.jpg?v=1.2`],
  ];

  it.each(victimSpellings)('avatar ofiary: %s', async (_label, storedUrl) => {
    state.avatars = [{ avatar_url: storedUrl, account_id: VICTIM }];
    await expect(findForeignAssetOwner(ATTACKER_INPUT, ATTACKER)).resolves.toBe(
      'FOREIGN'
    );
  });

  it.each(victimSpellings)('galeria ofiary: %s', async (_label, storedUrl) => {
    state.gallery = [{ asset_url: storedUrl, created_by_account_id: VICTIM }];
    await expect(findForeignAssetOwner(ATTACKER_INPUT, ATTACKER)).resolves.toBe(
      'FOREIGN'
    );
  });

  it.each(victimSpellings)(
    'zdjęcie wizyty ofiary: %s',
    async (_label, storedUrl) => {
      state.photos = [{ asset_url: storedUrl, stylist_account_id: VICTIM }];
      await expect(
        findForeignAssetOwner(ATTACKER_INPUT, ATTACKER)
      ).resolves.toBe('FOREIGN');
    }
  );
});

describe('findForeignAssetOwner — brak fałszywych trafień', () => {
  it('własny wiersz nie blokuje właścicielki', async () => {
    state.avatars = [{ avatar_url: ATTACKER_INPUT, account_id: ATTACKER }];
    await expect(findForeignAssetOwner(ATTACKER_INPUT, ATTACKER)).resolves.toBe(
      'OWN'
    );
  });

  it('cudzy wiersz o identyfikatorze-nadzbiorze nie blokuje', async () => {
    state.gallery = [
      {
        asset_url: `${BASE}/v1700000000/nailfolio/X-2.jpg`,
        created_by_account_id: VICTIM,
      },
    ];
    await expect(findForeignAssetOwner(ATTACKER_INPUT, ATTACKER)).resolves.toBe(
      'OWN'
    );
  });

  it('pusta baza nie blokuje', async () => {
    await expect(findForeignAssetOwner(ATTACKER_INPUT, ATTACKER)).resolves.toBe(
      'OWN'
    );
  });

  it('adres nie do rozłożenia jest odrzucany po stronie wejścia', async () => {
    await expect(
      findForeignAssetOwner(`${BASE}/nailfolio/X.jpg`, ATTACKER)
    ).resolves.toBe('UNRECOGNIZED_URL');
  });
});

it('zapytanie NIE zawęża kandydatów literałem (regresja luki HIGH)', async () => {
  await findForeignAssetOwner(ATTACKER_INPUT, ATTACKER);
  // Sześć zapytań, nie trzy: trzy po indeksie (`findFirst`) i trzy po wierszach
  // nierozkładalnych (`findMany`). Obie ścieżki są konieczne — patrz DECISION w bramce.
  expect(state.lastArgs).toHaveLength(6);
  expect(JSON.stringify(state.lastArgs)).not.toContain('contains');
});

/**
 * DWIE ŚCIEŻKI BRAMKI (S113) — indeks i wiersze nierozkładalne.
 *
 * KLASA BŁĘDU, którą ta suita pinuje: po dodaniu kolumny `public_id` najbardziej
 * naturalne zapytanie — indeksowany `findFirst` — CICHO odtwarza lukę HIGH z 2026-09-09.
 * Wiersz, którego adresu nie da się rozłożyć, ma `public_id = NULL`, więc indeks go NIE
 * WIDZI; gdyby bramka pytała wyłącznie po indeksie, taki wiersz przestałby chronić swój
 * plik i napastnik ustawiłby sobie kanoniczny adres cudzego zdjęcia. Wydajność nie jest
 * powodem, żeby tę ścieżkę wyciąć — dlatego jest tu przypadek, który się na tym wywala.
 */
describe('findForeignAssetOwner — ścieżka indeksowa i ścieżka NULL', () => {
  const PUBLIC_ID = 'nailfolio/X';

  it('ŚCIEŻKA A: cudzy wiersz z wypełnionym public_id blokuje (odczyt po indeksie)', async () => {
    state.gallery = [
      {
        // adres celowo INNY w zapisie — po wypełnionym identyfikatorze i tak trafiamy
        asset_url: `${BASE}/w_500/v1700000000/nailfolio/X.jpg`,
        created_by_account_id: VICTIM,
        public_id: PUBLIC_ID,
      },
    ];
    await expect(findForeignAssetOwner(ATTACKER_INPUT, ATTACKER)).resolves.toBe(
      'FOREIGN'
    );
  });

  it('ŚCIEŻKA A: wypełniony identyfikator NALEŻĄCY DO NAS nie blokuje', async () => {
    state.gallery = [
      {
        asset_url: ATTACKER_INPUT,
        created_by_account_id: ATTACKER,
        public_id: PUBLIC_ID,
      },
    ];
    await expect(findForeignAssetOwner(ATTACKER_INPUT, ATTACKER)).resolves.toBe(
      'OWN'
    );
  });

  it('ŚCIEŻKA B (SEDNO): wiersz ofiary z public_id = NULL i adresem NIEKANONICZNYM dalej blokuje', async () => {
    // Dokładnie ten kształt luki HIGH: backfill nie umiał rozłożyć adresu, więc
    // identyfikatora nie ma, a napastnik podaje kanoniczny wariant TEGO SAMEGO pliku.
    // Sam indeks orzekłby tu OWN.
    state.avatars = [
      {
        avatar_url: `${BASE}/v1700000000/nailfolio//X.jpg`,
        account_id: VICTIM,
        avatar_public_id: null,
      },
    ];
    await expect(findForeignAssetOwner(ATTACKER_INPUT, ATTACKER)).resolves.toBe(
      'FOREIGN'
    );
  });

  it('ŚCIEŻKA B: działa dla wszystkich trzech tabel, nie tylko dla avatara', async () => {
    state.photos = [
      {
        asset_url: `${BASE}/v1700000000/nailfolio/./X.jpg`,
        stylist_account_id: VICTIM,
        public_id: null,
      },
    ];
    await expect(findForeignAssetOwner(ATTACKER_INPUT, ATTACKER)).resolves.toBe(
      'FOREIGN'
    );
  });

  it('ścieżka indeksowa pyta o KONKRETNY identyfikator, a nie o całą kolumnę', async () => {
    await findForeignAssetOwner(ATTACKER_INPUT, ATTACKER);
    const serialized = JSON.stringify(state.lastArgs);
    expect(serialized).toContain(PUBLIC_ID);
    // ...a ścieżka NULL-owa faktycznie pyta o `null`, czyli nie zniknęła po drodze.
    expect(serialized).toContain('"public_id":null');
    expect(serialized).toContain('"avatar_public_id":null');
  });
});
