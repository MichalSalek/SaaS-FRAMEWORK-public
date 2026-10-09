import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';

// DECISION (nie usuwaj tego komentarza):
// Schemat Prisma (aplikowany przez `prisma db push` na DEVELOPMENT i `prisma migrate deploy`
// poza nim, patrz docker-entrypoint.sh) NIE wyraza: (a) partial-unique z filtrem
// WHERE, (b) CHECK constraintow. Oba to STRUKTURALNE backstopy invariantow, ktorych warstwa
// aplikacyjna nie egzekwuje sama (FK cascade omija helpery licznikow; check-then-act pod READ
// COMMITTED przepuszcza duplikat). Tworzymy je idempotentnie raw-SQL na starcie (ensureDbInvariants)
// i WERYFIKUJEMY ich obecnosc (verifyDbInvariants). instrumentation.ts robi z tego BLOKUJACY krok:
// brak invariantu PO ensure na STAGING/PRODUCTION = fail-fast (nie serwuj ruchu z nieegzekwowanym
// SC-2 / floorami licznikow); na DEVELOPMENT = warn + continue (fail-safe, np. preexisting duplikaty).
// Ani `db push`, ani baseline migracji generowany ze schema.prisma NIE zarzadza tymi obiektami (schema ich nie zna) — dlatego ensure+verify, nie migracja.

// SC-2 (DOMAIN_SSOT §3.2): max 1 niesterminalna sesja per para client/stylist + per-client cap.
// Partial-unique z filtrem WHERE — nieekspresowalny w Prisma schema. Bez tego check-then-act
// findFirst pod READ COMMITTED pozwala dwom rownoleglym TX scommitowac duplikat zywej sesji;
// galezie `catch (P2002 ... active_pair)` w create/add-photo zaczynaja dzialac dopiero gdy index istnieje.
const SESSION_CONTAINER_ACTIVE_PAIR_INDEX = 'session_container_active_pair_uq';

// SSOT nazw: kolumny z schema.prisma model SessionContainer (`client_account_id`,
// `stylist_account_id` nullable, `lifecycle_state`); wartosci terminalne CLOSED/EXPIRED.
const SESSION_CONTAINER_ACTIVE_PAIR_INDEX_SQL = `
  CREATE UNIQUE INDEX IF NOT EXISTS "${SESSION_CONTAINER_ACTIVE_PAIR_INDEX}"
  ON "SessionContainer" ("client_account_id", "stylist_account_id")
  WHERE "lifecycle_state" NOT IN ('CLOSED', 'EXPIRED')
    AND "stylist_account_id" IS NOT NULL
`;

// CHECK(>=0) backstop dla denormalizowanych licznikow StylistAccount. Pod poprawnym kodem
// (single-owner helpery + GREATEST(0)) nigdy nie strzela; zamienia przyszly floor-forgetting /
// double-decrement w GLOSNY blad zapisu zamiast cichego ujemnego serwowanego publicznie. Postgres
// nie ma `ADD CONSTRAINT IF NOT EXISTS` dla CHECK -> idempotencja przez DO-block sprawdzajacy
// pg_constraint.conname. ADD CONSTRAINT waliduje istniejace wiersze: na fresh/floored danych
// przechodzi; gdyby istnial ujemny (nie powinien) -> ALTER rzuca, per-statement catch loguje,
// a verifyDbInvariants zaraportuje brak -> staging/prod fail-fast (operator czysci).
type CounterCheck = { readonly constraint: string; readonly column: string };

const COUNTER_CHECKS: readonly CounterCheck[] = [
  { constraint: 'ck_stylistaccount_view_count_nonneg', column: 'view_count' },
  {
    constraint: 'ck_stylistaccount_cached_bookmark_count_nonneg',
    column: 'cached_bookmark_count',
  },
  {
    constraint: 'ck_stylistaccount_cached_gallery_count_nonneg',
    column: 'cached_gallery_count',
  },
  {
    constraint: 'ck_stylistaccount_cached_likes_count_nonneg',
    column: 'cached_likes_count',
  },
];

const counterCheckSql = ({ constraint, column }: CounterCheck): string => `
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${constraint}') THEN
      ALTER TABLE "StylistAccount" ADD CONSTRAINT "${constraint}" CHECK ("${column}" >= 0);
    END IF;
  END $$;
`;

// Pojedyncze DDL fail-safe: jedna porazka (preexisting duplikat blokujacy unique, ujemny licznik
// blokujacy CHECK) NIE blokuje pozostalych ani boota — loguje i kontynuuje. Gating (czy invariant
// faktycznie powstal) robi verifyDbInvariants() + instrumentation.ts. Static DDL, zero user input
// -> $executeRawUnsafe z constant string jest bezpieczny.
const ensureStatement = async (label: string, sql: string): Promise<void> => {
  try {
    await DB_CLIENT.use.$executeRawUnsafe(sql);
  } catch (error) {
    reportIssueBackend({
      namespace: 'ensureDbInvariants',
      message: `Failed to ensure "${label}" — likely preexisting data violating this invariant (dedup/clean required before it can be enforced).`,
      payload: error,
      mode: 'error',
    });
  }
};

/**
 * Idempotentny startowy ensure-step dla obiektow nieaplikowanych przez `db push` ani `migrate deploy`:
 * partial-unique active-pair (SC-2) + CHECK(>=0) na licznikach StylistAccount.
 *
 * Nigdy nie rzuca — per-statement fail-safe (`IF NOT EXISTS` / DO-block czynia kazdy krok
 * bezpiecznym przy kazdym cold start i kazdej instancji w klastrze). Gating — czy invariant
 * FAKTYCZNIE powstal — robi verifyDbInvariants() + instrumentation.ts (fail-fast staging/prod).
 */
export const ensureDbInvariants = async (): Promise<void> => {
  await ensureStatement(
    SESSION_CONTAINER_ACTIVE_PAIR_INDEX,
    SESSION_CONTAINER_ACTIVE_PAIR_INDEX_SQL
  );
  for (const check of COUNTER_CHECKS) {
    await ensureStatement(check.constraint, counterCheckSql(check));
  }
};

/**
 * Read-only weryfikacja, ze wszystkie wymagane invarianty (partial-unique active-pair + 4 CHECK-i
 * licznikow) FAKTYCZNIE istnieja w bazie. Zwraca liste brakujacych nazw obiektow (pusta = OK).
 * instrumentation.ts uzywa tego do fail-fast na STAGING/PRODUCTION — nie serwowac ruchu, gdy
 * invariant po ensure nadal nie istnieje (gałęzie catch P2002 active_pair martwe / floory off).
 */
export const verifyDbInvariants = async (): Promise<{ missing: string[] }> => {
  const missing: string[] = [];

  const indexRows = await DB_CLIENT.use.$queryRaw<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes WHERE indexname = ${SESSION_CONTAINER_ACTIVE_PAIR_INDEX}`;
  if (indexRows.length === 0) {
    missing.push(SESSION_CONTAINER_ACTIVE_PAIR_INDEX);
  }

  const checkRows = await DB_CLIENT.use.$queryRaw<{ conname: string }[]>`
    SELECT conname FROM pg_constraint WHERE conname LIKE 'ck_stylistaccount_%_nonneg'`;
  const present = new Set(checkRows.map(row => row.conname));
  for (const check of COUNTER_CHECKS) {
    if (!present.has(check.constraint)) {
      missing.push(check.constraint);
    }
  }

  return { missing };
};
