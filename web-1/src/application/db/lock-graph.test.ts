/**
 * Writer-pair model of the lock graph (application/db/LOCK_GRAPH.md).
 *
 * Each writer is its FULL row-lock sequence on a shared cast of rows, including what the checker in
 * lock-order.ts cannot see: implicit UPDATE locks (FOR NO KEY UPDATE) and the FOR KEY SHARE an INSERT's
 * FK check takes on its parent. Two writers can deadlock when each holds a row the other later needs in
 * a conflicting mode. The model is hand-maintained documentation in executable form: when a writer's
 * lock sequence changes, change it here and in LOCK_GRAPH.md. The live proof of C1 and C2 is
 * tests/concurrency/lock-order.concurrency.ts.
 */
import { describe, it, expect } from 'vitest';
import type { LockMode } from './lock-order';

type Step = { row: string; mode: LockMode };
type Writer = { name: string; steps: Step[] };

const KS: LockMode = 'FOR KEY SHARE';
const NKU: LockMode = 'FOR NO KEY UPDATE';
const FU: LockMode = 'FOR UPDATE';
const s = (row: string, mode: LockMode): Step => ({ row, mode });

// Postgres row-level lock conflict table.
const CONFLICTS: Record<LockMode, readonly LockMode[]> = {
  'FOR KEY SHARE': ['FOR UPDATE'],
  'FOR SHARE': ['FOR NO KEY UPDATE', 'FOR UPDATE'],
  'FOR NO KEY UPDATE': ['FOR SHARE', 'FOR NO KEY UPDATE', 'FOR UPDATE'],
  'FOR UPDATE': [
    'FOR KEY SHARE',
    'FOR SHARE',
    'FOR NO KEY UPDATE',
    'FOR UPDATE',
  ],
};
const conflict = (a: LockMode, b: LockMode): boolean =>
  CONFLICTS[a].includes(b);

// Strongest mode a writer holds on `row` after its first `upTo` steps.
const heldMode = (w: Writer, row: string, upTo: number): LockMode | null => {
  const order: LockMode[] = [
    'FOR KEY SHARE',
    'FOR SHARE',
    'FOR NO KEY UPDATE',
    'FOR UPDATE',
  ];
  let best: LockMode | null = null;
  for (const step of w.steps.slice(0, upTo)) {
    if (
      step.row === row &&
      (best === null || order.indexOf(step.mode) > order.indexOf(best))
    ) {
      best = step.mode;
    }
  }
  return best;
};

/**
 * A two-transaction deadlock exists when A, having completed steps [0, i), waits at step i on a row B
 * holds after steps [0, k), while B waits at step k on a row A holds, and both prefixes can be held at
 * once (no conflict between them).
 */
const findDeadlock = (a: Writer, b: Writer): string | null => {
  for (let i = 0; i < a.steps.length; i++) {
    for (let k = 0; k < b.steps.length; k++) {
      const aWants = a.steps[i];
      const bWants = b.steps[k];
      if (!aWants || !bWants) {
        continue;
      }
      // both prefixes compatible?
      const rows = new Set(
        [...a.steps.slice(0, i), ...b.steps.slice(0, k)].map(st => st.row)
      );
      let compatible = true;
      for (const row of rows) {
        const ma = heldMode(a, row, i);
        const mb = heldMode(b, row, k);
        if (ma && mb && conflict(ma, mb)) {
          compatible = false;
        }
      }
      if (!compatible) {
        continue;
      }
      const bHolds = heldMode(b, aWants.row, k);
      const aHolds = heldMode(a, bWants.row, i);
      const aOwn = heldMode(a, aWants.row, i);
      const bOwn = heldMode(b, bWants.row, k);
      if (
        bHolds &&
        conflict(aWants.mode, bHolds) &&
        aOwn === null &&
        aHolds &&
        conflict(bWants.mode, aHolds) &&
        bOwn === null
      ) {
        return `${a.name} waits ${aWants.row} ${aWants.mode} held by ${b.name}; ${b.name} waits ${bWants.row} ${bWants.mode} held by ${a.name}`;
      }
    }
  }
  return null;
};

// Cast: client C (user U_C), stylist Y (account S_Y, owner user U_O), pair P = (C, Y), session SC,
// visit VR, a salon member M (user U_M) of salon S_Y, a support thread ST of C.
const CURRENT: Writer[] = [
  {
    name: 'favoriteAdd',
    steps: [s('U_C', KS), s('S_Y', FU), s('U_C', KS), s('S_Y', NKU)],
  },
  { name: 'favoriteRemove', steps: [s('S_Y', FU), s('S_Y', NKU)] },
  { name: 'sessionCreate', steps: [s('U_C', FU), s('S_Y', KS)] },
  {
    name: 'sessionShareSalonPair',
    steps: [s('U_C', FU), s('S_Y', KS), s('P', NKU), s('SC', NKU)],
  },
  {
    name: 'revoke',
    steps: [s('S_Y', FU), s('P', FU), s('SC', NKU), s('P', NKU)],
  },
  {
    name: 'visitCreate',
    steps: [
      s('U_C', KS),
      s('S_Y', KS),
      s('P', FU),
      s('U_C', KS),
      s('S_Y', KS),
      s('SC', KS),
    ],
  },
  {
    name: 'visitUpdate',
    steps: [s('U_C', KS), s('S_Y', KS), s('P', FU), s('VR', NKU)],
  },
  { name: 'visitResultPhoto', steps: [s('P', FU), s('VR', FU)] },
  { name: 'contactReveal', steps: [s('P', FU)] },
  { name: 'pairRequestAccept', steps: [s('P', NKU)] },
  { name: 'addSessionPhoto', steps: [s('SC', FU), s('SC', NKU)] },
  {
    name: 'banStylist',
    steps: [s('U_O', NKU), s('S_Y', FU), s('S_Y', NKU), s('U_O', NKU)],
  },
  { name: 'disableSelfStylist', steps: [s('U_O', NKU), s('S_Y', FU)] },
  { name: 'stripeWebhook', steps: [s('S_Y', NKU)] },
  { name: 'galleryPin', steps: [s('S_Y', FU)] },
  {
    name: 'salonInvitationAttach',
    steps: [s('U_M', KS), s('S_Y', FU), s('U_M', KS)],
  },
  { name: 'memberSessionCreateWithSalon', steps: [s('U_M', FU), s('S_Y', KS)] },
  { name: 'supportAddMessage', steps: [s('U_C', FU), s('ST', FU)] },
  { name: 'moderationStrike', steps: [s('U_C', FU), s('U_C', NKU)] },

  {
    name: 'hardDeleteClient',
    steps: [s('U_C', FU), s('S_Y', NKU), s('U_C', FU)],
  },
  {
    name: 'archiveMoveClient',
    steps: [s('U_C', FU), s('S_Y', NKU), s('U_C', FU)],
  },
  // Re-onboarding / switch-role of the stylist owner: users first, account write, role write on users.
  {
    name: 'reOnboardStylist',
    steps: [s('U_O', NKU), s('S_Y', NKU), s('U_O', NKU)],
  },
  { name: 'switchRoleCreateAccount', steps: [s('U_O', NKU), s('U_O', KS)] },
];

// The shapes before the ordered-acquire fix, each the reverse half of a measured cycle.
const BEFORE: Record<string, Writer> = {
  favoriteAdd: {
    name: 'favoriteAdd(before)',
    steps: [s('S_Y', FU), s('U_C', KS), s('S_Y', NKU)],
  },
  visitCreate: {
    name: 'visitCreate(before)',
    steps: [s('P', FU), s('U_C', KS), s('S_Y', KS)],
  },
  salonInvitationAttach: {
    name: 'salonInvitationAttach(before)',
    steps: [s('S_Y', FU), s('U_M', KS)],
  },
  // N1: the delete decremented Y's counters before locking the users row (its DELETE); the cycle
  // appeared once favorite add took users KEY SHARE first.
  hardDeleteClient: {
    name: 'hardDeleteClient(before)',
    steps: [s('S_Y', NKU), s('U_C', FU)],
  },
  // N2: onboarding wrote the StylistAccount, then the users row (reconcileActiveRole).
  reOnboardStylist: {
    name: 'reOnboardStylist(before)',
    steps: [s('S_Y', NKU), s('U_O', NKU)],
  },
};

const byName = (name: string): Writer => {
  const w = CURRENT.find(x => x.name === name);
  if (!w) {
    throw new Error(`no writer ${name}`);
  }
  return w;
};

describe('lock graph: writer pairs', () => {
  it('no pair of current writers (including a writer with itself) can deadlock', () => {
    const cycles: string[] = [];
    for (const a of CURRENT) {
      for (const b of CURRENT) {
        const found = findDeadlock(a, b);
        if (found) {
          cycles.push(found);
        }
      }
    }
    expect(cycles).toEqual([]);
  });

  it.each([
    ['C1', BEFORE.favoriteAdd, 'sessionCreate'],
    ['C1', BEFORE.favoriteAdd, 'sessionShareSalonPair'],
    ['C2', BEFORE.visitCreate, 'revoke'],
    ['C4', BEFORE.salonInvitationAttach, 'memberSessionCreateWithSalon'],
    ['N1', BEFORE.hardDeleteClient, 'favoriteAdd'],
    ['N2', BEFORE.reOnboardStylist, 'banStylist'],
  ])(
    '%s: the pre-fix shape deadlocks with %s (the detector sees the measured cycle)',
    (_id, before, other) => {
      expect(before).toBeDefined();
      if (!before) {
        return;
      }
      expect(findDeadlock(before, byName(other))).not.toBeNull();
    }
  );

  it('C3: revoke closing sessions before locking the pair deadlocks with a pair re-activating share', () => {
    const revokeBefore: Writer = {
      name: 'revoke(before)',
      steps: [s('S_Y', FU), s('SC', NKU), s('P', NKU)],
    };
    // the share that re-activates P after a third writer made it ACTIVE (state-gated, see LOCK_GRAPH.md)
    const shareReactivating: Writer = {
      name: 'shareReactivating',
      steps: [s('U_C', FU), s('P', NKU), s('SC', NKU)],
    };
    expect(findDeadlock(revokeBefore, shareReactivating)).not.toBeNull();
    expect(findDeadlock(byName('revoke'), shareReactivating)).toBeNull();
  });
});
