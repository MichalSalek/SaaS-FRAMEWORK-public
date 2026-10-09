// THE FIX: whole query built with Prisma.sql, finished object passed as an
// ARGUMENT. Flattening happens in THIS module, so both sides of `instanceof Sql`
// come from one copy of sql-template-tag and Prisma receives one flat Sql.
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

export const lockActivePair = async (
  tx: Prisma.TransactionClient,
  clientUserId: string,
  requireActiveClient: boolean
): Promise<Array<{ id: string }>> => {
  const activeClientClause = requireActiveClient
    ? Prisma.sql`AND "client_is_active" = true`
    : Prisma.empty;

  const query = Prisma.sql`
    SELECT "id" FROM "ClientStylistPair"
     WHERE "client_user_id" = ${clientUserId}
       ${activeClientClause}
     FOR UPDATE`;
  return tx.$queryRaw<Array<{ id: string }>>(query);
};
