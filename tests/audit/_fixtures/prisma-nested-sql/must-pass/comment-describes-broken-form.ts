// Fixture standalone (bez importów): każda próbka jest kopiowana pojedynczo do
// mini-projektu selftestu, a tsconfig testów i tak kompiluje ten katalog.
declare namespace Prisma {
  type Sql = { readonly __sql: 'Sql' };
  type TransactionClient = {
    $queryRaw: <T>(query: TemplateStringsArray | Sql, ...values: unknown[]) => Promise<T>;
    $executeRaw: (query: TemplateStringsArray | Sql, ...values: unknown[]) => Promise<number>;
  };
}
declare const Prisma: {
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => Prisma.Sql;
  empty: Prisma.Sql;
  join: (values: unknown[]) => Prisma.Sql;
};

/**
 * Comment-awareness proof. lock-rows.ts carries a DECISION block that spells the
 * BROKEN form out verbatim so the next agent does not reinvent it:
 *
 *   const activeClientClause = cond ? Prisma.sql`AND x = 1` : Prisma.empty;
 *   await tx.$queryRaw`SELECT … ${activeClientClause} FOR UPDATE`;
 *
 * A guard that fires on prose describing the pattern makes rephrasing the
 * documentation the "fix" — this repo has paid that three times already.
 */
export const listPairs = async (tx: Prisma.TransactionClient, ids: string[]) =>
  tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "ClientStylistPair" WHERE "id" IN (${Prisma.join(ids)})`
  );
