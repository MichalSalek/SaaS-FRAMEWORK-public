// UI/shared/hooks/urlSyncedState.query.ts
// Pure query-string helpers of useUrlSyncedState (shared with its URL writer).

export type QueryRecord = Record<string, string | string[] | undefined>;

export const serialiseQuery = (query: QueryRecord): string => {
  const params = new URLSearchParams();
  for (const key of Object.keys(query).sort()) {
    const value = query[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, item);
      }
    } else if (value !== undefined && value !== '') {
      params.append(key, value);
    }
  }
  return params.toString();
};

/** `query` narrowed to the codec's own parameters. */
export const pickOwned = (
  query: QueryRecord,
  keys: readonly string[]
): QueryRecord => {
  const owned: QueryRecord = {};
  for (const key of keys) {
    if (query[key] !== undefined) {
      owned[key] = query[key];
    }
  }
  return owned;
};

/** Everything in `query` the codec does NOT own, kept as it stands in the URL. */
export const pickForeign = (
  query: QueryRecord,
  keys: readonly string[]
): QueryRecord => {
  const foreign: QueryRecord = {};
  for (const key of Object.keys(query)) {
    if (!keys.includes(key)) {
      foreign[key] = query[key];
    }
  }
  return foreign;
};
