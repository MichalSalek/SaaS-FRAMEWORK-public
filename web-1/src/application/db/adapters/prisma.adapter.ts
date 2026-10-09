import type { Prisma as PrismaAppLogs } from '../../../prisma-app-logs/js-client';
import { PrismaClient as PrismaClientAppLogs } from '../../../prisma-app-logs/js-client';
import type { Prisma } from '../../../prisma/js-client';
import { PrismaClient } from '../../../prisma/js-client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { debuggerStates } from '@app/debugger/debugger.state';
import { ENV_VARS } from '@app/environment/environment.config';
import {
  observePrimaryDatabaseError,
  observePrimaryDatabaseRelease,
} from '../db-availability.state';
import {
  APP_LOGS_DATABASE_POOL_TUNING,
  MAIN_DATABASE_POOL_TUNING,
} from '../database-pool.config';

declare global {
  var globalPrisma: PrismaClient;
  var globalPrismaAppLogs: PrismaClientAppLogs;
}

const prismaDatabaseLogsDebugConfig: Prisma.Subset<
  Prisma.PrismaClientOptions,
  Prisma.PrismaClientOptions
> = debuggerStates.isEnabledDBLeaksDebugger
  ? {
      log: [
        {
          emit: 'event',
          level: 'query',
        },
        {
          emit: 'event',
          level: 'error',
        },
        {
          emit: 'event',
          level: 'info',
        },
        {
          emit: 'event',
          level: 'warn',
        },
      ],
    }
  : {};

const createMainPrismaClient = (): PrismaClient => {
  const pool = new Pool({
    connectionString: ENV_VARS.DATABASE_URL,
    ...MAIN_DATABASE_POOL_TUNING,
  });
  // `release` runs after pool.query and carries its error. Unlike `acquire`, it
  // does not report UP before the checked-out client has actually been used.
  pool.on('release', observePrimaryDatabaseRelease);
  pool.on('error', observePrimaryDatabaseError);

  const adapter = new PrismaPg(pool, {
    disposeExternalPool: true,
    onPoolError: observePrimaryDatabaseError,
    onConnectionError: observePrimaryDatabaseError,
  });

  return new PrismaClient({
    errorFormat: 'pretty' as Prisma.ErrorFormat,
    adapter,
    ...prismaDatabaseLogsDebugConfig,
  } as Prisma.PrismaClientOptions);
};

if (global.globalPrisma == null) {
  global.globalPrisma = createMainPrismaClient();
}
const dbClient: PrismaClient = global.globalPrisma;

const prismaAppLogsDebugConfig: PrismaAppLogs.Subset<
  PrismaAppLogs.PrismaClientOptions,
  PrismaAppLogs.PrismaClientOptions
> = debuggerStates.isEnabledDBLeaksDebugger
  ? {
      log: [
        {
          emit: 'event',
          level: 'query',
        },
        {
          emit: 'event',
          level: 'error',
        },
        {
          emit: 'event',
          level: 'info',
        },
        {
          emit: 'event',
          level: 'warn',
        },
      ],
    }
  : {};

const createAppLogsPrismaClient = (): PrismaClientAppLogs => {
  const pool = new Pool({
    connectionString: ENV_VARS.DATABASE_APP_LOGS_URL,
    ...APP_LOGS_DATABASE_POOL_TUNING,
  });
  const adapter = new PrismaPg(pool, { disposeExternalPool: true });

  return new PrismaClientAppLogs({
    errorFormat: 'pretty' as PrismaAppLogs.ErrorFormat,
    adapter,
    ...prismaAppLogsDebugConfig,
  } as PrismaAppLogs.PrismaClientOptions);
};

if (global.globalPrismaAppLogs == null) {
  global.globalPrismaAppLogs = createAppLogsPrismaClient();
}
const dbClientAppLogs: PrismaClientAppLogs = global.globalPrismaAppLogs;

export const DB_CLIENT_PRISMA = {
  use: dbClient,
  useAppLogs: dbClientAppLogs,
} as const;
