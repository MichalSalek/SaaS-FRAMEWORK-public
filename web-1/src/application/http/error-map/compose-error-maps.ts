// Composition of the per-domain error maps into one map, with duplicate keys rejected twice:
// at compile time (the argument type turns into `{ duplicateErrorKeys }`) and at module load
// (a throw), because an object spread silently lets the later map win a collision.

type KeysOfAll<T extends readonly object[]> = T extends readonly [
  infer Head,
  ...infer Rest extends readonly object[],
]
  ? keyof Head | KeysOfAll<Rest>
  : never;

/** Every key that appears in more than one map of the tuple. */
type DuplicateKeys<T extends readonly object[]> = T extends readonly [
  infer Head,
  ...infer Rest extends readonly object[],
]
  ? (keyof Head & KeysOfAll<Rest>) | DuplicateKeys<Rest>
  : never;

type MergeAll<T extends readonly object[]> = T extends readonly [
  infer Head,
  ...infer Rest extends readonly object[],
]
  ? Head & MergeAll<Rest>
  : unknown;

type DisjointMaps<T extends readonly object[]> = [DuplicateKeys<T>] extends [
  never,
]
  ? T
  : { duplicateErrorKeys: DuplicateKeys<T> };

/** Keys present in more than one map (runtime twin of `DuplicateKeys`). */
export const findDuplicateErrorKeys = (maps: readonly object[]): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const map of maps) {
    for (const key of Object.keys(map)) {
      if (seen.has(key)) {
        duplicates.add(key);
      }
      seen.add(key);
    }
  }
  return [...duplicates];
};

export const composeErrorMaps = <T extends readonly object[]>(
  maps: DisjointMaps<T> & T
): MergeAll<T> => {
  const duplicates = findDuplicateErrorKeys(maps);
  if (duplicates.length > 0) {
    throw new Error(
      `Error map composition: duplicate error types ${duplicates.join(', ')}`
    );
  }
  const composed: Record<string, unknown> = {};
  for (const map of maps) {
    Object.assign(composed, map);
  }
  // The loop above copies every key of every map, so `composed` has exactly the shape of the
  // intersection; TypeScript cannot follow a runtime loop, hence the single assertion.
  return composed as MergeAll<T>;
};
