/**
 * i18n fidelity guard (FWE Wave H FAZA 2). Fuzzes EVERY request validator with malformed
 * inputs and asserts every emitted error token is a known VALIDATION_MESSAGES i18n key
 * (`validation.*`), never a raw zod-default message ("Invalid input", "Expected ...").
 *
 * The characterization tests pin WHICH field is rejected; this pins that the rejection
 * carries a localizable key, so the zod migration cannot silently leak English zod
 * defaults to the client. Scoped to the whole VALIDATION_POLICY.validators surface.
 */
import { describe, it, expect } from 'vitest';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { VALIDATION_MESSAGES } from '@kernel/domain/i18n/validation.i18n';

const collectKeys = (obj: unknown, acc: Set<string>): Set<string> => {
  if (typeof obj === 'string') {
    acc.add(obj.trim());
  } else if (obj !== null && typeof obj === 'object') {
    for (const value of Object.values(obj)) {
      collectKeys(value, acc);
    }
  }
  return acc;
};
const KNOWN = collectKeys(VALIDATION_MESSAGES, new Set<string>());

// Object-only inputs: request.middleware coalesces every non-plain-object body to {}
// before a validator runs, so {} / real objects are the only inputs seen in production.
// Rich wrong-typed objects exercise type-error + value-error message paths broadly.
const BATTERY: unknown[] = [
  {},
  { garbage: true, nested: { x: 1 } },
  {
    id: 123,
    value: {},
    take: 'x',
    limit: -1,
    offset: -5,
    color_ids: 'no',
    trait_ids: 9,
    nail_length: 123,
    email: 7,
    name: {},
    cursor: '',
    account_id: 88,
    stylist_account_id: [],
    apply_strict_filter: 'yes',
    key: 99,
    note: 5,
  },
  {
    id: '',
    value: '',
    take: 999999,
    limit: 0,
    nail_length: 'NOPE',
    email: 'bad',
    color_ids: [123],
    trait_ids: [''],
    name: 'x'.repeat(9999),
    note: {},
  },
  {
    content: '\uD800',
    note: 'x\uDFFF',
    service_note: '\uD83D',
    pair_id: 'p',
    client_user_id: 'c',
  },
];

describe('validation i18n fidelity — every error token is a known i18n key', () => {
  const validators = Object.entries(VALIDATION_POLICY.validators);
  it(`covers all ${validators.length} validators with no zod-default leaks`, () => {
    const leaks: string[] = [];
    for (const [name, validator] of validators) {
      for (const input of BATTERY) {
        const result = validator(input) as Record<string, unknown>;
        for (const [field, value] of Object.entries(result)) {
          if (field === '__isValid' || typeof value !== 'string') {
            continue;
          }
          for (const token of value.trim().split(/\s+/).filter(Boolean)) {
            if (!KNOWN.has(token)) {
              leaks.push(`${name}.${field}: "${token}"`);
            }
          }
        }
      }
    }
    expect(leaks, `non-i18n-key tokens leaked:\n${leaks.join('\n')}`).toEqual(
      []
    );
  });
});
