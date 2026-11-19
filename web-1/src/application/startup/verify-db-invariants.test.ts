import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryRaw = vi.hoisted(() => vi.fn());
const executeRawUnsafe = vi.hoisted(() => vi.fn());
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    use: { $queryRaw: queryRaw, $executeRawUnsafe: executeRawUnsafe },
  },
}));

import {
  SESSION_CONTAINER_ACTIVE_PAIR_INDEX,
  STYLIST_ACCOUNT_COUNTER_CHECKS,
  STYLIST_ACCOUNT_COUNTER_CHECK_COLUMNS,
  evaluateDbInvariants,
  formatDbInvariantProblems,
  isBlockingDbInvariantProblem,
  normalizeCheckDefinition,
  normalizeIndexPredicate,
  verifyDbInvariants,
} from './verify-db-invariants';

// pg_get_expr / pg_get_constraintdef output measured on PG16 and PG17 (and production PG 17.11).
const PG_PREDICATE =
  '((lifecycle_state <> ALL (ARRAY[\'CLOSED\'::"SessionContainerLifecycleState", \'EXPIRED\'::"SessionContainerLifecycleState"])) AND (stylist_account_id IS NOT NULL))';

const VALID_INDEX = {
  indisvalid: true,
  indisunique: true,
  table_name: 'SessionContainer',
  columns: ['client_account_id', 'stylist_account_id'],
  predicate: PG_PREDICATE,
};
const ALL_CHECKS = STYLIST_ACCOUNT_COUNTER_CHECKS.map(conname => ({
  conname,
  convalidated: true,
  definition: `CHECK ((${STYLIST_ACCOUNT_COUNTER_CHECK_COLUMNS[conname]} >= 0))`,
}));
const INDEX_MISMATCH = [
  { name: SESSION_CONTAINER_ACTIVE_PAIR_INDEX, kind: 'definition_mismatch' },
];

describe('normalisation', () => {
  it('reduces the measured PG predicate to the expected form', () => {
    expect(normalizeIndexPredicate(PG_PREDICATE)).toBe(
      "lifecycle_state<>allarray['closed','expired']andstylist_account_idisnotnull"
    );
  });

  it('ignores a trailing NOT VALID in a CHECK definition', () => {
    expect(
      normalizeCheckDefinition('CHECK ((view_count >= 0)) NOT VALID')
    ).toBe('checkview_count>=0');
  });
});

describe('evaluateDbInvariants', () => {
  it('reports nothing when the index matches and every CHECK is validated', () => {
    expect(evaluateDbInvariants([VALID_INDEX], ALL_CHECKS)).toEqual([]);
  });

  it('reports a missing index and missing CHECKs as blocking', () => {
    const problems = evaluateDbInvariants([], []);
    expect(problems).toHaveLength(1 + STYLIST_ACCOUNT_COUNTER_CHECKS.length);
    expect(problems[0]).toEqual({
      name: SESSION_CONTAINER_ACTIVE_PAIR_INDEX,
      kind: 'missing',
    });
    expect(problems.every(isBlockingDbInvariantProblem)).toBe(true);
  });

  it('treats an INVALID index (interrupted CONCURRENTLY build) as blocking', () => {
    const problems = evaluateDbInvariants(
      [{ ...VALID_INDEX, indisvalid: false }],
      ALL_CHECKS
    );
    expect(problems).toEqual([
      { name: SESSION_CONTAINER_ACTIVE_PAIR_INDEX, kind: 'invalid' },
    ]);
    expect(problems.every(isBlockingDbInvariantProblem)).toBe(true);
  });

  it('treats a non-unique same-definition index as invalid', () => {
    expect(
      evaluateDbInvariants([{ ...VALID_INDEX, indisunique: false }], ALL_CHECKS)
    ).toEqual([{ name: SESSION_CONTAINER_ACTIVE_PAIR_INDEX, kind: 'invalid' }]);
  });

  it.each([
    ['another table', { table_name: 'VisitRecord' }],
    ['other columns', { columns: ['client_account_id'] }],
    [
      'columns in another order',
      { columns: ['stylist_account_id', 'client_account_id'] },
    ],
    ['no predicate', { predicate: null }],
    [
      'another predicate',
      {
        predicate:
          '(lifecycle_state <> \'CLOSED\'::"SessionContainerLifecycleState")',
      },
    ],
  ])('reports a same-named index on %s as definition_mismatch', (_, patch) => {
    const problems = evaluateDbInvariants(
      [{ ...VALID_INDEX, ...patch }],
      ALL_CHECKS
    );
    expect(problems).toEqual(INDEX_MISMATCH);
    expect(problems.every(isBlockingDbInvariantProblem)).toBe(true);
  });

  it('reports a same-named CHECK with another expression as definition_mismatch', () => {
    const [first] = STYLIST_ACCOUNT_COUNTER_CHECKS;
    const checks = ALL_CHECKS.map(row =>
      row.conname === first
        ? { ...row, definition: 'CHECK ((view_count >= -1))' }
        : row
    );
    expect(evaluateDbInvariants([VALID_INDEX], checks)).toEqual([
      { name: first, kind: 'definition_mismatch' },
    ]);
  });

  it('reports a NOT VALID CHECK as not_validated, which is not blocking', () => {
    const [first] = STYLIST_ACCOUNT_COUNTER_CHECKS;
    const checks = ALL_CHECKS.map(row =>
      row.conname === first
        ? {
            ...row,
            convalidated: false,
            definition: `${row.definition} NOT VALID`,
          }
        : row
    );
    const problems = evaluateDbInvariants([VALID_INDEX], checks);
    expect(problems).toEqual([{ name: first, kind: 'not_validated' }]);
    expect(problems.some(isBlockingDbInvariantProblem)).toBe(false);
    expect(formatDbInvariantProblems(problems)).toBe(
      `${first} (not_validated)`
    );
  });
});

describe('verifyDbInvariants', () => {
  beforeEach(() => {
    queryRaw.mockReset();
    executeRawUnsafe.mockReset();
  });

  it('reads the catalog only and never runs DDL', async () => {
    queryRaw
      .mockResolvedValueOnce([VALID_INDEX])
      .mockResolvedValueOnce(ALL_CHECKS);

    await expect(verifyDbInvariants()).resolves.toEqual([]);

    expect(executeRawUnsafe).not.toHaveBeenCalled();
    expect(queryRaw).toHaveBeenCalledTimes(2);
    const sql = queryRaw.mock.calls
      .map(([strings]) => (strings as readonly string[]).join('?'))
      .join('\n');
    expect(sql).toMatch(/pg_index/);
    expect(sql).toMatch(/pg_constraint/);
    expect(sql).not.toMatch(/\b(CREATE|ALTER|DROP)\b/i);
  });

  it('propagates a catalog read failure to the caller', async () => {
    queryRaw.mockRejectedValueOnce(new Error('connection lost'));
    await expect(verifyDbInvariants()).rejects.toThrow('connection lost');
  });
});
