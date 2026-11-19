import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/cors/cors.config', () => ({
  CORS_ALLOWED_ORIGINS: [],
}));

vi.mock('@app/environment/environment.config', () => ({
  ENV_VARS: {
    FRONTEND_PUBLIC_DOMAIN: 'front.example.test',
    FRONTEND_PUBLIC_PORT: '',
  },
}));

vi.mock('@app/environment/environment.utils.api', () => ({
  IS_DEVELOPMENT_ENV: () => false,
}));

import {
  EXCHANGE_CODE_PREFIX,
  mintExchangeCode,
  redeemExchangeCode,
} from './auth-token-bridge';

const TOKEN = 'session-token-value';
const CODE = 'abc123';

type Row = {
  value: string;
  identifier: string;
  expiresAt: Date;
};

const future = (): Date => new Date(Date.now() + 60_000);
const past = (): Date => new Date(Date.now() - 60_000);

// Fresh literals passed straight into redeem are excess-checked against the
// production store. This keeps the old find/delete pair on the double so a
// revert to that pair fails the race test instead of throwing.
const storeOf = <T>(store: T): T => store;

/**
 * Both finds return the same row before either delete runs, and delete is void.
 * That is the installed Prisma adapter: delete-by-identifier is deleteMany and
 * the count is discarded, so two waiters both already hold the token.
 */
const openRace = (row: Row) => {
  let waiting = 2;
  let open: () => void = () => undefined;
  const opened = new Promise<void>(resolve => {
    open = resolve;
  });
  let consumed = false;
  return {
    createVerificationValue: async (data: Row) => data,
    findVerificationValue: async (_identifier: string) => {
      waiting -= 1;
      if (waiting === 0) {
        open();
      }
      await opened;
      return row;
    },
    deleteVerificationByIdentifier: async (_identifier: string) => undefined,
    consumeVerificationValue: async (_identifier: string) => {
      if (consumed) {
        return null;
      }
      consumed = true;
      return row.expiresAt < new Date() ? null : row;
    },
  };
};

const consistent = (row: Row | null) => {
  let current = row;
  const read = async () => current;
  return {
    createVerificationValue: async (data: Row) => data,
    findVerificationValue: read,
    deleteVerificationByIdentifier: async () => {
      current = null;
    },
    consumeVerificationValue: async () => {
      const found = current;
      current = null;
      if (!found || found.expiresAt < new Date()) {
        return null;
      }
      return found;
    },
  };
};

describe('redeemExchangeCode', () => {
  it('gives the token to one concurrent caller and null to the other', async () => {
    const store = openRace({
      value: TOKEN,
      identifier: `${EXCHANGE_CODE_PREFIX}${CODE}`,
      expiresAt: future(),
    });
    const results = await Promise.all([
      redeemExchangeCode(store, CODE),
      redeemExchangeCode(store, CODE),
    ]);
    expect(results.filter(result => result === TOKEN)).toHaveLength(1);
    expect(results.filter(result => result === null)).toHaveLength(1);
  });

  it('returns the token once, then null', async () => {
    const store = consistent({
      value: TOKEN,
      identifier: `${EXCHANGE_CODE_PREFIX}${CODE}`,
      expiresAt: future(),
    });
    expect(await redeemExchangeCode(store, CODE)).toBe(TOKEN);
    expect(await redeemExchangeCode(store, CODE)).toBeNull();
  });

  it('returns null when the row is missing', async () => {
    const store = consistent(null);
    expect(await redeemExchangeCode(store, CODE)).toBeNull();
  });

  it('returns null for an expired row and still consumes it', async () => {
    let burned = false;
    const store = storeOf({
      createVerificationValue: async (data: Row) => data,
      findVerificationValue: async () => ({
        value: TOKEN,
        identifier: `${EXCHANGE_CODE_PREFIX}${CODE}`,
        expiresAt: past(),
      }),
      deleteVerificationByIdentifier: async () => {
        burned = true;
      },
      consumeVerificationValue: async () => {
        burned = true;
        return null;
      },
    });
    expect(await redeemExchangeCode(store, CODE)).toBeNull();
    expect(burned).toBe(true);
  });

  it('returns null when consume hands back an already-expired row', async () => {
    const store = storeOf({
      createVerificationValue: async (data: Row) => data,
      findVerificationValue: async () => null,
      deleteVerificationByIdentifier: async () => undefined,
      consumeVerificationValue: async () => ({
        value: TOKEN,
        identifier: `${EXCHANGE_CODE_PREFIX}${CODE}`,
        expiresAt: past(),
      }),
    });
    expect(await redeemExchangeCode(store, CODE)).toBeNull();
  });

  it('returns null for an empty or non-string value', async () => {
    const empty = consistent({
      value: '',
      identifier: `${EXCHANGE_CODE_PREFIX}${CODE}`,
      expiresAt: future(),
    });
    expect(await redeemExchangeCode(empty, CODE)).toBeNull();

    const weird = storeOf({
      createVerificationValue: async (data: Row) => data,
      findVerificationValue: async () => null,
      deleteVerificationByIdentifier: async () => undefined,
      consumeVerificationValue: async () =>
        ({
          value: 12,
          identifier: `${EXCHANGE_CODE_PREFIX}${CODE}`,
          expiresAt: future(),
        }) as unknown as Row,
    });
    expect(await redeemExchangeCode(weird, CODE)).toBeNull();
  });

  it('returns null when the adapter throws', async () => {
    const store = storeOf({
      createVerificationValue: async (data: Row) => data,
      findVerificationValue: async () => {
        throw new Error('adapter down');
      },
      deleteVerificationByIdentifier: async () => {
        throw new Error('adapter down');
      },
      consumeVerificationValue: async () => {
        throw new Error('adapter down');
      },
    });
    expect(await redeemExchangeCode(store, CODE)).toBeNull();
  });

  it('returns null for an empty or non-string code without touching the store', async () => {
    const store = storeOf({
      createVerificationValue: async (data: Row) => data,
      findVerificationValue: async () => {
        throw new Error('should not be called');
      },
      deleteVerificationByIdentifier: async () => {
        throw new Error('should not be called');
      },
      consumeVerificationValue: async () => {
        throw new Error('should not be called');
      },
    });
    expect(await redeemExchangeCode(store, '')).toBeNull();
    expect(
      await redeemExchangeCode(store, undefined as unknown as string)
    ).toBeNull();
  });
});

describe('mintExchangeCode', () => {
  it('stores a 256-bit code under the xchg prefix for 60 seconds', async () => {
    const saved: { row: Row | null } = { row: null };
    const code = await mintExchangeCode(
      {
        createVerificationValue: async data => {
          saved.row = data;
          return data;
        },
        consumeVerificationValue: async () => null,
      },
      TOKEN
    );
    const row = saved.row;
    if (row === null) {
      throw new Error('mint did not store a row');
    }
    expect(code).toMatch(/^[0-9a-f]{64}$/);
    expect(row.identifier).toBe(`${EXCHANGE_CODE_PREFIX}${code}`);
    expect(row.value).toBe(TOKEN);
    const ttl = row.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(55_000);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });
});
