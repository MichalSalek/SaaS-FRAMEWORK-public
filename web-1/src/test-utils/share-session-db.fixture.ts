import { mockDb } from './mockApiHandler';
type MockSpec = Parameters<typeof mockDb>[0];

export const mockSessionDb = (spec: MockSpec) => {
  const models = spec as Record<string, Record<string, unknown>>;
  const sc = models['sessionContainer'];
  const count = sc?.['count'] as
    ((arg: unknown) => Promise<number>) | undefined;
  if (sc !== undefined && count !== undefined && sc['findMany'] === undefined) {
    sc['findMany'] = async (arg: unknown) =>
      Array.from({ length: await count(arg) }, (_, i) => ({
        stylist_account_id: `st_direct_${i}`,
      }));
  }
  const pair = models['clientStylistPair'];
  if (pair !== undefined && pair['findMany'] === undefined) {
    pair['findMany'] = async () => [];
  }
  const stylist = models['stylistAccount'] ?? {};
  const findStylist = stylist['findUnique'] as
    ((arg: unknown) => Promise<unknown>) | undefined;
  models['stylistAccount'] = {
    ...stylist,
    findUnique: async (arg: unknown) => {
      const query = arg as { select?: { created_by_user_id?: boolean } };
      if (query.select?.created_by_user_id === true) {
        return { created_by_user_id: 'usr_stylist_parent' };
      }
      return findStylist ? findStylist(arg) : null;
    },
  };
  mockDb(spec);
};
