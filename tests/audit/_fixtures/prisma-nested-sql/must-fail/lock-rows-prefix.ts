// RED-first proof: the EXACT pre-fix shape of lockActivePair (lock-rows.ts) that
// shipped a 500 to production. The fragment is a VARIABLE, not a literal
// `Prisma.sql` between the backticks — a literal-only grep reports green here.
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
  stylistAccountId: string,
  { requireActiveClient = false }: { requireActiveClient?: boolean } = {}
): Promise<Array<{ id: string }>> => {
  const activeClientClause = requireActiveClient
    ? Prisma.sql`AND EXISTS (
         SELECT 1 FROM "users" u
          WHERE u."id" = "ClientStylistPair"."client_user_id"
            AND u."is_active" = true
       )`
    : Prisma.empty;

  return tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
      FROM "ClientStylistPair"
     WHERE "client_user_id" = ${clientUserId}
       AND "stylist_account_id" = ${stylistAccountId}
       AND "status"::text = 'ACTIVE'
       ${activeClientClause}
     FOR UPDATE`;
};
