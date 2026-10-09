// Seed a SUPPORT-side reply for an existing thread (for screenshot demo).
// Run from web-1/ : node scripts/seed-support-reply.mjs <threadId>
import pkg from '@prisma/client';
const { PrismaClient } = pkg;

const threadId = process.argv[2];
if (!threadId) {
  console.error('Usage: node scripts/seed-support-reply.mjs <threadId>');
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL env var');
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl,
    },
  },
});

await prisma.supportMessage.create({
  data: {
    thread_id: threadId,
    sender_type: 'SUPPORT',
    content:
      'Cześć! Dzięki za zgłoszenie — sprawdzamy to teraz. Wstępnie wygląda na cache po stronie przeglądarki: kliknij Ctrl+Shift+R na desktopie i daj znać, czy pomogło.',
  },
});

await new Promise(r => setTimeout(r, 50));

await prisma.supportMessage.create({
  data: {
    thread_id: threadId,
    sender_type: 'SUPPORT',
    content:
      'A na wszelki wypadek prześlij screenshot pustej siatki — pomoże nam ustalić, czy chodzi o twoje konto czy szerszy bug. Wrócę najpóźniej do końca dnia.',
  },
});

console.log('Seeded 2 SUPPORT replies for thread', threadId);
await prisma.$disconnect();
