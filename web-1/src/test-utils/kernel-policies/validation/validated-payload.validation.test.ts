/**
 * A kernel validator's success carries the parser's output in `__data` (the only payload a
 * handler receives); a failure carries none. Covers the superRefine-gated validators (sendLog,
 * updateStylistProfile, salonStaffUpdate), sessionDeleteAll, and the strip / transform contract.
 */
import { describe, it, expect } from 'vitest';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';

const V = VALIDATION_POLICY.validators;

const dataOf = (r: { __isValid: boolean; __data?: unknown }): unknown => {
  expect(r.__isValid).toBe(true);
  return r.__data;
};

const rejected = (r: Record<string, unknown>, field: string): boolean =>
  typeof r[field] === 'string' && (r[field] as string).trim().length > 0;

describe('validator verdict: success carries __data, failure does not', () => {
  it('success → __data is the parsed object, error slots stay empty strings', () => {
    const r = V.accountIncrementView({ stylist_account_id: 'sa_1', x: 1 });
    expect(dataOf(r)).toEqual({ stylist_account_id: 'sa_1' });
    expect(r.stylist_account_id).toBe('');
    expect(r.__general).toBe('');
  });

  it('failure → no __data key at all', () => {
    const r = V.accountIncrementView({ stylist_account_id: '' });
    expect(r.__isValid).toBe(false);
    expect('__data' in r).toBe(false);
  });
});

describe('adminSendLog payload', () => {
  const valid = {
    environment: 'production',
    namespace: 'UI',
    type: 'error',
    message: 'boom',
    payload: '',
    user_metadata: '',
  };

  it('strips keys outside the contract (the operation spreads the payload into a log row)', () => {
    expect(
      dataOf(V.adminSendLog({ ...valid, application: 'backend', id: 'x' }))
    ).toEqual({ ...valid, user_id: null });
  });

  it('user_id never rejects: a non-empty string is kept, anything else becomes null', () => {
    expect(dataOf(V.adminSendLog({ ...valid, user_id: 'u_1' }))).toMatchObject({
      user_id: 'u_1',
    });
    for (const user_id of ['', 42, { gt: '' }, null]) {
      expect(dataOf(V.adminSendLog({ ...valid, user_id }))).toMatchObject({
        user_id: null,
      });
    }
  });

  it('client_url never rejects: a non-string is dropped (the operation falls back to Referer)', () => {
    expect(
      dataOf(V.adminSendLog({ ...valid, client_url: 7 })) as object
    ).not.toHaveProperty('client_url', 7);
    expect(
      dataOf(V.adminSendLog({ ...valid, client_url: '/app' }))
    ).toMatchObject({ client_url: '/app' });
  });

  it('every field error still lands in __general only', () => {
    const r = V.adminSendLog({ ...valid, environment: 1, type: 'INFO' });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, '__general')).toBe(true);
    expect(r.environment).toBe('');
    expect(r.type).toBe('');
  });
});

describe('updateStylistProfile payload', () => {
  it('passes the request sections and strips unknown top-level keys', () => {
    const social = { instagram_handle: 'studio.nails' };
    expect(
      dataOf(V.updateStylistProfile({ social, account_id: 'someone_else' }))
    ).toEqual({ social });
  });

  it('a null section reads as absent', () => {
    const social = { instagram_handle: 'studio.nails' };
    expect(dataOf(V.updateStylistProfile({ social, location: null }))).toEqual({
      social,
    });
  });

  it('a section that is not an object is rejected on its own slot', () => {
    const r = V.updateStylistProfile({ social: 'studio.nails' });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'instagram_handle')).toBe(true);
  });

  it('a non-object location gives one cityRequired issue, not two', () => {
    const r = V.updateStylistProfile({ location: 'Warszawa' });
    expect(r.__isValid).toBe(false);
    expect(r.location.trim().split(' ').length).toBe(1);
  });
});

describe('salonStaffUpdate payload', () => {
  it('a role is rejected in any form', () => {
    for (const role of ['OWNER', 'EMPLOYEE', 1]) {
      const r = V.salonStaffUpdate({ role, permissions: ['GALLERY_VIEW'] });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'role')).toBe(true);
    }
  });

  it('success carries the permissions list alone', () => {
    expect(
      dataOf(
        V.salonStaffUpdate({ permissions: ['GALLERY_VIEW'], role: null, x: 1 })
      )
    ).toEqual({ permissions: ['GALLERY_VIEW'], role: null });
  });
});

describe('sessionDeleteAll payload', () => {
  it('no body or no id = self logout', () => {
    expect(dataOf(V.sessionDeleteAll(undefined))).toEqual({});
    expect(dataOf(V.sessionDeleteAll({}))).toEqual({});
  });

  it('a string id passes', () => {
    expect(dataOf(V.sessionDeleteAll({ id: 'u_1' }))).toEqual({ id: 'u_1' });
  });

  it('an operator object or any non-string id is rejected (deleteMany injection)', () => {
    for (const id of [{ gt: '' }, ['u_1'], 1, null]) {
      const r = V.sessionDeleteAll({ id });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'id')).toBe(true);
    }
  });
});
