import { PrismaClient } from '../src/prisma/js-client/index.js';

async function main() {
  console.log('--- DB Connection Test Debug Script ---');
  const customUrl = process.env.DATABASE_URL;
  if (!customUrl) {
    throw new Error('Missing DATABASE_URL env var');
  }
  console.log(`Testing DATABASE_URL: ${customUrl.substring(0, 30)}...`);

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: customUrl,
      },
    },
    log: ['query', 'info', 'warn', 'error'],
  });

  try {
    console.log('Attempting to connect...');
    await prisma.$connect();
    console.log('✅ Connection successful!');

    console.log('Attempting simple query (User count)...');
    const count = await prisma.user.count();
    console.log(`✅ Query successful! User count: ${count}`);
  } catch (e: unknown) {
    console.error('❌ Connection or Query failed:');
    console.error(e instanceof Error ? e.message : e);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
