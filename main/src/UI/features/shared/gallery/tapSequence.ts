// Per-record tap sequence for optimistic toggles (favorite heart).
//
// Every tap fires its own request and they run in parallel, so they can settle
// in any order. A failure may only roll back the optimistic state while it is
// still the NEWEST tap on that record: an older request that fails last must
// not overwrite (or wipe) the state a newer tap already set.

export interface TapSequence {
  /** Registers a new tap on `id` and returns its sequence number. */
  begin: (id: string) => number;
  /** True while `seq` is still the newest tap registered for `id`. */
  isLatest: (id: string, seq: number) => boolean;
}

export function createTapSequence(): TapSequence {
  const latest = new Map<string, number>();
  let counter = 0;
  return {
    begin: id => {
      counter += 1;
      latest.set(id, counter);
      return counter;
    },
    isLatest: (id, seq) => latest.get(id) === seq,
  };
}
