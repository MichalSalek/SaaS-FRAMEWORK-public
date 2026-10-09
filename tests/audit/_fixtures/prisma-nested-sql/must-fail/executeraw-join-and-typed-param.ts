// Dwie pozostałe drogi, którymi fragment wchodzi do tagowanego szablonu:
// `$executeRaw` (nie tylko `$queryRaw`) z `Prisma.join`, oraz PARAMETR
// anotowany `Prisma.Sql` w szablonie z zagnieżdżonym generykiem.
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

export const purge = async (tx: Prisma.TransactionClient, ids: string[]) => {
  const inClause = Prisma.join(ids);
  return tx.$executeRaw`DELETE FROM "GalleryRecord" WHERE "id" IN (${inClause})`;
};

export const countBy = async (tx: Prisma.TransactionClient, clause: Prisma.Sql) =>
  tx.$queryRaw<Array<{ date: Date; count: bigint }>>`
    SELECT now() AS date, count(*) AS count FROM "GalleryRecord" WHERE 1 = 1 ${clause}`;
