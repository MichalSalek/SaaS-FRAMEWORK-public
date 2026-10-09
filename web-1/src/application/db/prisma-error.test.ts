import { describe, expect, it } from 'vitest';
import {
  classifyQueryFailure,
  isDatabaseConnectivityError,
} from './prisma-error';

describe('isDatabaseConnectivityError', () => {
  it.each([
    { code: 'P1001' },
    { code: 'ECONNRESET' },
    { originalCode: '08006' },
    { cause: { kind: 'DatabaseNotReachable' } },
    { cause: { cause: { kind: 'SocketTimeout' } } },
    new Error('Neon compute endpoint is suspended'),
    // Neon compute-quota exhaustion (incydent 2026-07-19→31): SQLSTATE 53000,
    // przychodzi jako DriverAdapterError (zagnieżdżony cause.code) lub P2010.
    { code: '53000' },
    { code: 'P2010', cause: { cause: { code: '53000' } } },
    // $queryRaw podczas quota-outage: kod XX000 (spoza setu), rozpoznanie
    // wyłącznie po message.
    {
      code: 'XX000',
      message:
        'Your account or project has exceeded the compute time quota. Upgrade your plan to increase limits.',
    },
  ])('recognizes database availability failures', error => {
    expect(isDatabaseConnectivityError(error)).toBe(true);
  });

  it.each([
    { code: 'P2002' },
    { code: 'P2025' },
    // P1008 means an operation timed out; a slow/locked statement does not
    // prove that the database is unavailable.
    { code: 'P1008' },
    { originalCode: '40001' },
    { originalCode: '40P01' },
    new Error('invalid input syntax for type uuid'),
  ])('does not turn query/domain failures into outages', error => {
    expect(isDatabaseConnectivityError(error)).toBe(false);
  });
});

describe('classifyQueryFailure', () => {
  it.each([
    ['P2002 known-request', { code: 'P2002' }],
    [
      'adapter 23505',
      { cause: { kind: 'UniqueConstraintViolation', originalCode: '23505' } },
    ],
    [
      'wrapped adapter error',
      {
        code: 'X',
        meta: { driverAdapterError: { cause: { originalCode: '23505' } } },
      },
    ],
  ])('%s → UNIQUE_CONFLICT', (_label, error) => {
    expect(classifyQueryFailure(error)).toBe('UNIQUE_CONFLICT');
  });

  it.each([
    ['P2003 known-request', { code: 'P2003' }],
    ['adapter FK kind', { cause: { kind: 'ForeignKeyConstraintViolation' } }],
    ['restrict 23001', { originalCode: '23001' }],
  ])('%s → REFERENCE_MISSING', (_label, error) => {
    expect(classifyQueryFailure(error)).toBe('REFERENCE_MISSING');
  });

  it.each([
    // NUL in a text parameter: adapter-pg has no kind for it → kind 'postgres' + SQLSTATE.
    [
      '22021 NUL byte (adapter, no P-code)',
      {
        name: 'DriverAdapterError',
        cause: { kind: 'postgres', originalCode: '22021' },
      },
    ],
    [
      '22021 via raw-query P2010',
      {
        code: 'P2010',
        meta: { driverAdapterError: { cause: { originalCode: '22021' } } },
      },
    ],
    ['P2007 data validation', { code: 'P2007' }],
    ['P2000 too long', { code: 'P2000' }],
    ['22P02 bad literal', { cause: { originalCode: '22P02' } }],
  ])('%s → INVALID_INPUT', (_label, error) => {
    expect(classifyQueryFailure(error)).toBe('INVALID_INPUT');
  });

  it.each([
    ['generic Error', new Error('db down')],
    [
      'PrismaClientValidationError (bad value OR our own malformed query)',
      Object.assign(
        new Error('Argument `address_country`: Invalid value provided'),
        { name: 'PrismaClientValidationError' }
      ),
    ],
    ['connectivity P1001', { code: 'P1001' }],
    [
      'serialization 40001',
      { cause: { kind: 'TransactionWriteConflict', originalCode: '40001' } },
    ],
    ['P2025 (domain must name it)', { code: 'P2025' }],
    ['P2011 NOT NULL (our bug)', { code: 'P2011' }],
    ['string', 'boom'],
    ['null', null],
  ])('%s → null (stays an opaque 500)', (_label, error) => {
    expect(classifyQueryFailure(error)).toBeNull();
  });

  it('terminates on a cyclic cause chain', () => {
    const a: Record<string, unknown> = { code: 'X' };
    a.cause = a;
    expect(classifyQueryFailure(a)).toBeNull();
  });
});
