// A justified escape suppresses the finding (and only the finding on its own
// template) — the documented exception mechanism of this repo.
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

export const countLikes = async (tx: Prisma.TransactionClient, onlyPublic: boolean) => {
  const clause = onlyPublic ? Prisma.sql`AND "is_public" = true` : Prisma.empty;
  // prisma-nested-sql-allow: sample proving the escape branch of the guard
  return tx.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM "GalleryRecord" WHERE 1 = 1 ${clause}`;
};
