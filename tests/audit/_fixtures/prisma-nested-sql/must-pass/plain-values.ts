// Ordinary VALUE interpolation in a tagged template is exactly what tagged
// templates are for (bind parameters, injection-safe) — must stay untouched,
// otherwise the guard would ban the 90+ healthy raw call sites in this repo.
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

export const lockUserRow = async (tx: Prisma.TransactionClient, userId: string, key: string) => {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(('x' || substr(md5(${key}), 1, 16))::bit(64)::bigint)::text AS locked`;
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
  return rows[0] ?? null;
};
