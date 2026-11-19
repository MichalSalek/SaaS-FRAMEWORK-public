/**
 * Cloud file ownership gate — tests candidate LOOKUP, not normalization itself
 * (cloudinary-url.utils.test.ts covers that).
 *
 * One property is pinned, and it was a real HIGH gap: the victim's row must reach the comparison
 * REGARDLESS of how its URL was written into the column. While candidates were picked by a
 * literal (`asset_url contains ...`) on the raw column, a non-canonical victim URL (`//`, `/./`,
 * `%2F`) could not be found, so the gate "correctly" compared an EMPTY SET and let an attacker
 * with the canonical URL of someone else's file through. The DB fake therefore keeps URLs
 * LITERALLY (like the column) and implements no filtering on purpose; since a regression to
 * literal narrowing would pass on it anyway, a second assertion checks that the query carries
 * no `contains`.
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
   * Faithful fake of DB-side filtering: the URL is compared LITERALLY, as in the column, so a
   * return to `contains` narrowing fails the tests instead of silently passing on a fake that
   * returns everything.
   */
  const matches = (
    row: Record<string, unknown>,
    where: WhereClause
  ): boolean => {
    for (const [column, clause] of Object.entries(where)) {
      if (column === 'OR') {
        continue;
      }
      // Identifier column: match by VALUE (index path) or by `null` (path for rows that cannot
      // be decomposed). A missing field in the fake = `null`, so the "victim stored
      // non-canonically" cases are NULL cases, exactly what the gate must protect.
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
      user: {
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
      },
      stylistAccount: {
        findUnique: vi.fn(async () => ({
          created_by_user_id: 'user_attacker',
          account_id: 'acc_attacker',
        })),
        findFirst: vi.fn(async (args: { where: WhereClause }) =>
          args.where.salon_logo_public_id !== undefined
            ? null
            : findFirst(() => state.avatars)(args)
        ),
        findMany: vi.fn(async (args: { where: WhereClause }) =>
          args.where.salon_logo_public_id !== undefined
            ? []
            : findMany(
                () => state.avatars,
                ({ avatar_url }): AvatarRow => ({ avatar_url })
              )(args)
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
  // Six queries, not three: three by index (`findFirst`) and three over unparseable rows
  // (`findMany`). Both paths are required; see the DECISION in cloudinary-asset.guard.ts.
  expect(state.lastArgs).toHaveLength(6);
  expect(JSON.stringify(state.lastArgs)).not.toContain('contains');
});

/**
 * TWO GATE PATHS — the index and rows that cannot be decomposed.
 *
 * Bug class pinned here: with the `public_id` column, the most natural query (an indexed
 * `findFirst`) SILENTLY reopens the HIGH gap. A row whose URL cannot be decomposed has
 * `public_id = NULL`, so the index does NOT SEE it; a gate asking only the index would stop
 * protecting that file and an attacker could set the canonical URL of someone else's photo.
 * Performance is no reason to drop that path, so a case that fails on it lives here.
 */
describe('findForeignAssetOwner — ścieżka indeksowa i ścieżka NULL', () => {
  const PUBLIC_ID = 'nailfolio/X';

  it('ŚCIEŻKA A: cudzy wiersz z wypełnionym public_id blokuje (odczyt po indeksie)', async () => {
    state.gallery = [
      {
        // the stored URL is deliberately DIFFERENT: the filled identifier still matches
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
    // Exactly the shape of the HIGH gap: the backfill could not decompose the URL, so there is
    // no identifier, and the attacker supplies the canonical variant of the SAME file.
    // The index alone would rule OWN here.
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
    // ...and the NULL path really asks for `null`, so it did not vanish along the way.
    expect(serialized).toContain('"public_id":null');
    expect(serialized).toContain('"avatar_public_id":null');
  });
});
