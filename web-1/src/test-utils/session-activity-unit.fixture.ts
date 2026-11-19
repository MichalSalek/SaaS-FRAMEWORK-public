import { mockDb as installMockDb } from './mockApiHandler';

type Models = Parameters<typeof installMockDb>[0];
/** Preserve the production lock/relationship call path while modelling its rows in unit fixtures. */
export function mockSessionActivityDb(
  models: Models,
  clientUserId: string
): void {
  const session = models['sessionContainer'];
  const pair = models['clientStylistPair'];
  const stylist = models['stylistAccount'];
  if (!session?.['findUnique']) {
    installMockDb(models);
    return;
  }
  const findUnique = session['findUnique'] as (
    args?: unknown
  ) => Promise<unknown>;
  let latest: Record<string, unknown> | null = null;
  const wrappedFindUnique = async (args?: unknown) => {
    const query = args as
      { include?: { client_account?: unknown } } | undefined;
    if (query?.include?.client_account != null) {
      return latest
        ? { ...latest, client_account: { created_by_user_id: clientUserId } }
        : null;
    }
    const value = await findUnique(args);
    if (
      value !== null &&
      typeof value === 'object' &&
      'id' in value &&
      'client_account_id' in value
    ) {
      latest = value as Record<string, unknown>;
    }
    return value;
  };
  installMockDb({
    ...models,
    $queryRaw: (async () => [
      { id: 'pair_1', last_message_at: null },
    ]) as unknown as Models[string],
    sessionContainer: {
      ...session,
      findUnique: wrappedFindUnique,
      findUniqueOrThrow: async () => latest,
    },
    stylistAccount: {
      ...stylist,
      findUnique: async (args?: unknown) => {
        const query = args as
          { select?: { created_by_user_id?: boolean } } | undefined;
        if (query?.select?.created_by_user_id === true) {
          return { created_by_user_id: 'stylist_user' };
        }
        const original = stylist?.['findUnique'] as
          ((input?: unknown) => Promise<unknown>) | undefined;
        return original ? original(args) : null;
      },
    },
    clientStylistPair: {
      findFirst: async () => ({ id: 'pair_1' }),
      ...pair,
      findUnique: async () =>
        latest?.['shared_at'] != null ? { id: 'pair_1' } : null,
    },
  });
}
