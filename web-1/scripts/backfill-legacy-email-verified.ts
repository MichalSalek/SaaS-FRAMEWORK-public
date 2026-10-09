/**
 * Jednorazowy backfill: `email_verified=true` dla legacy-kont sprzed
 * ujednolicenia stempla weryfikacji (incydent 2026-08-17, `account_not_linked`).
 *
 * DLACZEGO TO JEST BEZPIECZNE (a nie „rozdanie weryfikacji za darmo"):
 * w tym produkcie NIE MA haseł. Jedyną drogą, którą konto użytkownika może
 * powstać poza seedami, jest magic-link — a jego kliknięcie samo w sobie
 * dowodzi dostępu do skrzynki. Wiersz z `email_verified=false` i ZEREM
 * rekordów `Account` to więc konto założone magic-linkiem na starszej wersji
 * Better Auth (która nie stemplowała flagi), a nie konto niezweryfikowane.
 * Nowe Better Auth (1.6.x) ustawia `emailVerified: true` przy pierwszym
 * przejściu magic-linka, a seedy/dev-login stemplują to jawnie, więc ten
 * skrypt nie ma się już czym karmić poza historycznymi wierszami.
 *
 * DLACZEGO W OGÓLE: przy `email_verified=false` Better Auth odmawia podpięcia
 * logowania Google do istniejącego konta (`requireLocalEmailVerified`, opcja
 * @deprecated → gate wkrótce bezwarunkowy), więc użytkownik odbija się z
 * powrotem na ekran logowania zamiast wejść do aplikacji.
 *
 * ZAKRES (celowo wąski): tylko wiersze BEZ powiązanego `Account` i utworzone
 * PRZED datą odcięcia. Konta z podpiętym providerem i tak przechodzą, a data
 * odcięcia trzyma skrypt w roli jednorazowej naprawy historii zamiast
 * wiecznego „naprawiacza", który by cicho stemplował przyszłe rekordy.
 *
 * Usage (z katalogu web-1/):
 *   DATABASE_URL=<url> npx tsx scripts/backfill-legacy-email-verified.ts            # dry-run
 *   DATABASE_URL=<url> npx tsx scripts/backfill-legacy-email-verified.ts --apply
 *   ... --before=2026-08-18   (domyślnie: data wdrożenia fixu)
 */

import { DB_CLIENT } from '../src/application/db/db.client.js';

const DEFAULT_CUTOFF_ISO = '2026-08-18';

const parseArgs = (): { apply: boolean; before: Date } => {
  const args = process.argv.slice(2);
  const beforeArg = args.find(a => a.startsWith('--before='))?.split('=')[1];
  const before = new Date(`${beforeArg ?? DEFAULT_CUTOFF_ISO}T00:00:00.000Z`);
  if (Number.isNaN(before.getTime())) {
    throw new Error(`Nieczytelna data --before: ${String(beforeArg)}`);
  }
  return { apply: args.includes('--apply'), before };
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('Missing DATABASE_URL env var');
  }
  const { apply, before } = parseArgs();

  console.log('--- Backfill: legacy email_verified ---');
  console.log(`tryb: ${apply ? 'APPLY (zapis)' : 'DRY-RUN (bez zapisu)'}`);
  console.log(`odcięcie: konta utworzone przed ${before.toISOString()}`);

  await DB_CLIENT.use.$connect();

  const candidates = await DB_CLIENT.use.user.findMany({
    where: {
      emailVerified: false,
      createdAt: { lt: before },
      accounts: { none: {} },
    },
    select: { id: true, email: true, createdAt: true, account_type: true },
    orderBy: { createdAt: 'asc' },
  });

  if (candidates.length === 0) {
    console.log('Brak kandydatów — nic do zrobienia.');
    return;
  }

  console.log(`Kandydaci (${candidates.length}):`);
  for (const user of candidates) {
    console.log(
      `  ${user.email}  (${user.account_type}, utworzony ${user.createdAt.toISOString()})`
    );
  }

  if (!apply) {
    console.log('\nDRY-RUN — uruchom ponownie z --apply, aby zapisać.');
    return;
  }

  const result = await DB_CLIENT.use.user.updateMany({
    where: { id: { in: candidates.map(u => u.id) }, emailVerified: false },
    data: { emailVerified: true },
  });
  console.log(`\nZaktualizowano wierszy: ${result.count}`);
}

main()
  .catch((error: unknown) => {
    console.error('Backfill nie powiódł się:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void DB_CLIENT.use.$disconnect();
  });
