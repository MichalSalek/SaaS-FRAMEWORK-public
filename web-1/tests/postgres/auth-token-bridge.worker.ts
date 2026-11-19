// Separate OS process for tests/postgres/auth-token-bridge.pg.test.ts.
// `legacy` is the pre-fix find + delete-by-identifier pair (the delete is void).
// `redeem` calls production redeemExchangeCode. Stdout is only OUTCOME token|null|error.
// Test: auth-token-bridge.pg.test.ts (one row, two processes; not secondary storage).
import { PrismaPg } from '@prisma/adapter-pg';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { Pool } from 'pg';
import { USER_ADDITIONAL_FIELDS } from '../../src/application/auth/better-auth/user-fields.config';
import {
  EXCHANGE_CODE_PREFIX,
  redeemExchangeCode,
} from '../../src/application/auth/better-auth/auth-token-bridge';
import { PrismaClient } from '../../src/prisma/js-client/index.js';

const mode = process.argv[2];
const schema = process.env.BRIDGE_SCHEMA ?? '';
const code = process.env.BRIDGE_CODE ?? '';
const url = process.env.AUTH_HOT_PATH_DATABASE_URL;

const report = (kind: 'token' | 'null' | 'error'): void => {
  process.stdout.write(`OUTCOME ${kind}\n`);
};

type LegacyStore = {
  findVerificationValue: (identifier: string) => Promise<{
    value: string;
    expiresAt: Date;
  } | null>;
  deleteVerificationByIdentifier: (identifier: string) => Promise<void>;
};

const legacyRedeem = async (
  store: LegacyStore,
  exchangeCode: string
): Promise<'token' | 'null'> => {
  try {
    const identifier = `${EXCHANGE_CODE_PREFIX}${exchangeCode}`;
    const record = await store.findVerificationValue(identifier);
    if (!record) {
      return 'null';
    }
    await store.deleteVerificationByIdentifier(identifier);
    if (record.expiresAt < new Date()) {
      return 'null';
    }
    return typeof record.value === 'string' && record.value ? 'token' : 'null';
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error';
    process.stderr.write(`legacy ${name}\n`);
    return 'null';
  }
};

const main = async (): Promise<void> => {
  if (
    !url ||
    !/^auth_xchg_[a-z0-9]+$/.test(schema) ||
    code.length === 0 ||
    (mode !== 'legacy' && mode !== 'redeem')
  ) {
    report('error');
    return;
  }
  const pool = new Pool({
    connectionString: url,
    max: 4,
    application_name: 'nf-xchg-worker',
    options: `-c search_path=${schema},public -c application_name=nf-xchg-worker`,
  });
  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool, { schema }),
  });
  try {
    const auth = betterAuth({
      database: prismaAdapter(prisma, { provider: 'postgresql' }),
      secret: 'test-secret-test-secret-test-secret-012345',
      baseURL: 'http://127.0.0.1:3001',
      logger: { disabled: true },
      // The library find also deletes every expired verification row. That
      // delete waits on the parent's FOR UPDATE before find returns, so the
      // race would not be the identifier delete. Production leaves this on;
      // the test turns it off only to place the wait on the delete under test.
      verification: { disableCleanup: true },
      session: {
        fields: {
          expiresAt: 'expires',
          ipAddress: 'ip_address',
          userAgent: 'user_agent',
        },
        additionalFields: {
          device_type: { type: 'string', required: false, input: false },
        },
      },
      user: { additionalFields: USER_ADDITIONAL_FIELDS },
    });
    const store = (await auth.$context).internalAdapter;
    if (mode === 'legacy') {
      report(await legacyRedeem(store, code));
      return;
    }
    const value = await redeemExchangeCode(store, code);
    report(value ? 'token' : 'null');
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error';
    process.stderr.write(`worker ${name}\n`);
    report('error');
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
};

void main();
