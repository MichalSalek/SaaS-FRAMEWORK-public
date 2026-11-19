// Lower rank is taken FIRST. Tables not listed are not locked through lock-rows.
export const LOCK_RANK = {
  User: 10,
  StylistAccount: 20,
  ClientStylistPair: 30,
  SessionContainer: 40,
  VisitRecord: 50,
  GalleryRecord: 60,
  SupportThread: 70,
} as const;

export type LockTable = keyof typeof LOCK_RANK;

// Weakest to strongest (Postgres row-lock modes).
export const LOCK_MODES = [
  'FOR KEY SHARE',
  'FOR SHARE',
  'FOR NO KEY UPDATE',
  'FOR UPDATE',
] as const;

export type LockMode = (typeof LOCK_MODES)[number];

export type LockTarget = {
  table: LockTable;
  id: string;
  /** Default FOR UPDATE. */
  mode?: LockMode;
};

export type OrderedLockTarget = Required<LockTarget>;

const modeStrength = (mode: LockMode): number => LOCK_MODES.indexOf(mode);

// A shared mode lets other transactions hold the same row in a shared mode, so upgrading it to a
// stronger mode can deadlock against another holder doing the same.
const isSharedMode = (mode: LockMode): boolean =>
  mode === 'FOR KEY SHARE' || mode === 'FOR SHARE';

export const lockKey = (table: LockTable, id: string): string =>
  `${table}:${id}`;

export const compareLockTargets = (
  a: Pick<LockTarget, 'table' | 'id'>,
  b: Pick<LockTarget, 'table' | 'id'>
): number => {
  const byRank = LOCK_RANK[a.table] - LOCK_RANK[b.table];
  if (byRank !== 0) {
    return byRank;
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
};

/**
 * Deduplicate (the strongest requested mode wins) and sort by rank, then id. Pure; the order that
 * lockInOrder issues its statements in.
 */
export const sortLockTargets = (
  targets: readonly LockTarget[]
): OrderedLockTarget[] => {
  const byKey = new Map<string, OrderedLockTarget>();
  for (const target of targets) {
    const mode = target.mode ?? 'FOR UPDATE';
    const key = lockKey(target.table, target.id);
    const existing = byKey.get(key);
    if (!existing || modeStrength(mode) > modeStrength(existing.mode)) {
      byKey.set(key, { table: target.table, id: target.id, mode });
    }
  }
  return [...byKey.values()].sort(compareLockTargets);
};

export class LockOrderViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LockOrderViolationError';
  }
}

type HeldLocks = {
  generation: number;
  modes: Map<string, LockMode>;
  highest: { table: LockTable; id: string } | null;
};

let assertionsEnabled = false;
// Bumped by resetLockOrderTracking so a test-reused fake tx starts clean without enumerating the map.
let generation = 0;
const heldByTx = new WeakMap<object, HeldLocks>();

export const configureLockOrderAssertions = (enabled: boolean): void => {
  assertionsEnabled = enabled;
};

export const resetLockOrderTracking = (): void => {
  generation += 1;
};

const describe = (table: LockTable, id: string, mode: LockMode): string =>
  `${table}(${id}) ${mode}`;

/**
 * Record that `tx` is about to lock (table, id) in `mode`, and throw LockOrderViolationError when that
 * breaks the order relative to what `tx` already holds. Policy for locks already held:
 *   - the same row again in the same or a weaker mode: allowed (re-entrant helpers, e.g.
 *     ensureSalonPairing re-locking the client's user row the share op already holds);
 *   - the same row in a STRONGER mode after a shared mode: violation (upgrade deadlock);
 *   - a lower rank, or a lower id at the highest held rank: violation.
 * No-op while assertions are off.
 */
export const recordLockAcquisition = (
  tx: object,
  table: LockTable,
  id: string,
  mode: LockMode
): void => {
  if (!assertionsEnabled) {
    return;
  }
  let held = heldByTx.get(tx);
  if (!held || held.generation !== generation) {
    held = { generation, modes: new Map(), highest: null };
    heldByTx.set(tx, held);
  }

  const key = lockKey(table, id);
  const previous = held.modes.get(key);
  if (previous !== undefined) {
    if (modeStrength(mode) > modeStrength(previous) && isSharedMode(previous)) {
      throw new LockOrderViolationError(
        `Lock upgrade ${describe(table, id, previous)} -> ${mode}: take the strongest mode first.`
      );
    }
    if (modeStrength(mode) > modeStrength(previous)) {
      held.modes.set(key, mode);
    }
    return;
  }

  if (held.highest && compareLockTargets({ table, id }, held.highest) < 0) {
    throw new LockOrderViolationError(
      `Lock order violation: ${describe(table, id, mode)} requested after ${held.highest.table}(${held.highest.id}). ` +
        'Take locks in LOCK_RANK order, then by id (lockInOrder); see application/db/LOCK_GRAPH.md.'
    );
  }

  held.modes.set(key, mode);
  if (!held.highest || compareLockTargets({ table, id }, held.highest) > 0) {
    held.highest = { table, id };
  }
};

/** Locks recorded for `tx` (assertions on only), for tests. */
export const heldLocksOf = (tx: object): ReadonlyMap<string, LockMode> => {
  const held = heldByTx.get(tx);
  if (!held || held.generation !== generation) {
    return new Map();
  }
  return held.modes;
};
