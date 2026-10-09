/**
 * Display status of a log group (S126). The rule exists as a JS function
 * (labels rows for the response) and as a SQL CASE (filters and counts
 * "needs a reaction" before the LIMIT). The CASE is EVALUATED here, with SQL
 * three-valued logic, for every status combination and compared with the JS
 * function, so the two cannot drift apart unnoticed.
 */

import { describe, it, expect } from 'vitest';
import { LOG_ISSUE_STATUSES } from '@kernel/domain/admin/log-triage.config';
import { Prisma } from '../../../prisma-app-logs/js-client';
import {
  logIssueDisplayStatus,
  logIssueDisplayStatusSql,
} from './admin-log-display-status.helper';

// ── A tiny evaluator for the grammar the CASE uses ──────────────────────────
// CASE WHEN <cond> THEN <value> ... ELSE <value> END, where a condition is
// built from `x IS NULL`, `x IS NOT NULL`, `x NOT IN (...)`, `x = y`, `x > y`,
// AND, OR. Comparisons with NULL are UNKNOWN (null), as in Postgres.

type Scalar = string | number | null;
type Tri = boolean | null;
type Token = { kind: 'word'; text: string } | { kind: 'value'; value: Scalar };

const tokenize = (
  query: Prisma.Sql,
  columns: Record<string, Scalar>
): Token[] => {
  const tokens: Token[] = [];
  query.strings.forEach((chunk, index) => {
    for (const text of chunk.match(/::text|[A-Za-z_]+|[=>(),]/g) ?? []) {
      if (text === '::text') {
        continue; // a cast of the preceding bind parameter, no effect here
      }
      tokens.push(
        text in columns
          ? { kind: 'value', value: columns[text] ?? null }
          : { kind: 'word', text }
      );
    }
    if (index < query.values.length) {
      tokens.push({ kind: 'value', value: query.values[index] as Scalar });
    }
  });
  return tokens;
};

const triAnd = (a: Tri, b: Tri): Tri =>
  a === false || b === false ? false : a === null || b === null ? null : true;
const triOr = (a: Tri, b: Tri): Tri =>
  a === true || b === true ? true : a === null || b === null ? null : false;

const evaluateCase = (tokens: Token[]): Scalar => {
  let position = 0;
  const peekWord = (): string | null => {
    const token = tokens[position];
    return token?.kind === 'word' ? token.text : null;
  };
  const takeWord = (expected: string): void => {
    if (peekWord() !== expected) {
      throw new Error(`expected ${expected} at token ${position}`);
    }
    position += 1;
  };
  const takeValue = (): Scalar => {
    const token = tokens[position];
    if (token?.kind !== 'value') {
      throw new Error(`expected a value at token ${position}`);
    }
    position += 1;
    return token.value;
  };
  const predicate = (): Tri => {
    const left = takeValue();
    const word = peekWord();
    if (word === 'IS') {
      takeWord('IS');
      const negated = peekWord() === 'NOT';
      if (negated) {
        takeWord('NOT');
      }
      takeWord('NULL');
      return negated ? left !== null : left === null;
    }
    if (word === 'NOT') {
      takeWord('NOT');
      takeWord('IN');
      takeWord('(');
      const members: Scalar[] = [takeValue()];
      while (peekWord() === ',') {
        takeWord(',');
        members.push(takeValue());
      }
      takeWord(')');
      return left === null ? null : !members.includes(left);
    }
    if (word === '=' || word === '>') {
      takeWord(word);
      const right = takeValue();
      if (left === null || right === null) {
        return null;
      }
      return word === '=' ? left === right : left > right;
    }
    throw new Error(`unknown operator ${String(word)} at token ${position}`);
  };
  const conjunction = (): Tri => {
    let result = predicate();
    while (peekWord() === 'AND') {
      takeWord('AND');
      result = triAnd(result, predicate());
    }
    return result;
  };
  const condition = (): Tri => {
    let result = conjunction();
    while (peekWord() === 'OR') {
      takeWord('OR');
      result = triOr(result, conjunction());
    }
    return result;
  };

  takeWord('CASE');
  let outcome: Scalar | undefined;
  while (peekWord() === 'WHEN') {
    takeWord('WHEN');
    const matched = condition() === true;
    takeWord('THEN');
    const value = takeValue();
    if (matched && outcome === undefined) {
      outcome = value;
    }
  }
  takeWord('ELSE');
  const fallback = takeValue();
  takeWord('END');
  if (position !== tokens.length) {
    throw new Error('tokens left after END');
  }
  return outcome === undefined ? fallback : outcome;
};

const sqlDisplayStatus = (input: {
  storedStatus: string | null;
  statusUpdatedAt: Date | null;
  lastSeen: Date;
}): Scalar =>
  evaluateCase(
    tokenize(
      logIssueDisplayStatusSql({
        storedStatus: Prisma.sql`stored_status`,
        statusUpdatedAt: Prisma.sql`status_updated_at`,
        lastSeen: Prisma.sql`last_seen`,
      }),
      {
        stored_status: input.storedStatus,
        status_updated_at: input.statusUpdatedAt?.getTime() ?? null,
        last_seen: input.lastSeen.getTime(),
      }
    )
  );

describe('display status: the SQL CASE agrees with logIssueDisplayStatus', () => {
  const MARKED_AT = new Date('2026-02-01T00:00:00.000Z');
  const storedStatuses = [null, ...LOG_ISSUE_STATUSES, 'garbage', ''];
  const markTimes = [null, MARKED_AT];
  const lastSeens = [
    new Date(MARKED_AT.getTime() - 1),
    MARKED_AT,
    new Date(MARKED_AT.getTime() + 1),
  ];

  for (const storedStatus of storedStatuses) {
    for (const statusUpdatedAt of markTimes) {
      for (const lastSeen of lastSeens) {
        const label = `${String(storedStatus)} / marked ${statusUpdatedAt ? 'yes' : 'no'} / seen ${lastSeen.getTime() - MARKED_AT.getTime()}ms after`;
        it(label, () => {
          const input = { storedStatus, statusUpdatedAt, lastSeen };
          expect(sqlDisplayStatus(input)).toBe(logIssueDisplayStatus(input));
        });
      }
    }
  }

  it('the matrix reaches every display status (the comparison is not vacuous)', () => {
    const reached = new Set<Scalar>();
    for (const storedStatus of storedStatuses) {
      for (const lastSeen of lastSeens) {
        reached.add(
          sqlDisplayStatus({
            storedStatus,
            statusUpdatedAt: MARKED_AT,
            lastSeen,
          })
        );
      }
    }
    expect([...reached].sort()).toEqual(
      ['fixed', 'ignored', 'known', 'new', 'regressed'].sort()
    );
  });

  it('the evaluator itself notices a changed rule', () => {
    // Same CASE with the regression comparison turned around.
    const broken = Prisma.sql`CASE WHEN stored_status = ${'fixed'} AND status_updated_at > last_seen THEN ${'regressed'}::text ELSE stored_status END`;
    const value = evaluateCase(
      tokenize(broken, {
        stored_status: 'fixed',
        status_updated_at: 1,
        last_seen: 2,
      })
    );
    expect(value).toBe('fixed');
    expect(
      logIssueDisplayStatus({
        storedStatus: 'fixed',
        statusUpdatedAt: new Date(1),
        lastSeen: new Date(2),
      })
    ).toBe('regressed');
  });
});
