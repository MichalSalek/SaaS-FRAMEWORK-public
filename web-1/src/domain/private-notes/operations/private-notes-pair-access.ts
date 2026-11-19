import { clientPairAccessIsCurrent } from '@domain/pairing/pair-access-current';

/** Cache each client's decision across note lists, and bound concurrent database work. */
export const createCurrentPairFilter = (stylistAccountId: string) => {
  const checks = new Map<string, Promise<boolean>>();
  return async <T extends { salon_origin_account_id: string | null }>(
    pairs: T[],
    clientId: (pair: T) => string
  ): Promise<T[]> => {
    const current: T[] = [];
    for (let offset = 0; offset < pairs.length; offset += 16) {
      const checked = await Promise.all(
        pairs.slice(offset, offset + 16).map(async pair => {
          const id = clientId(pair);
          let check = checks.get(id);
          if (!check) {
            check = clientPairAccessIsCurrent(pair, id, stylistAccountId);
            checks.set(id, check);
          }
          return (await check) ? pair : null;
        })
      );
      current.push(...checked.filter(pair => pair !== null));
    }
    return current;
  };
};
