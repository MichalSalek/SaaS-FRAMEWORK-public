import { describe, expect, it } from 'vitest';
import { SUPPORT_LENGTHS } from '@kernel/policies/validation.config';
import plCommon from '../../locales/pl/common.json';
import enCommon from '../../locales/en/common.json';
import deCommon from '../../locales/de/common.json';

/**
 * The "too long" messages of the support forms state a number of characters.
 * That number is a product fact owned by SUPPORT_LENGTHS: until S126 the copy
 * said 200 and 5000 while the validator cut at 100 and 2000, in all three
 * languages. This test fails when any of the strings stops naming the limit
 * its validator applies (support.validation.ts).
 */
const LOCALES = { pl: plCommon, en: enCommon, de: deCommon } as const;

// Key -> the limit the validator enforces for the field that emits the key.
// `contentTooLong` serves the user's follow-up message (MESSAGE_MAX) and the
// admin reply (REPLY_MAX); the copy can only be true when the two are equal.
const LIMIT_BY_KEY = {
  subjectTooLong: SUPPORT_LENGTHS.SUBJECT_MAX,
  messageTooLong: SUPPORT_LENGTHS.MESSAGE_MAX,
  contentTooLong: SUPPORT_LENGTHS.MESSAGE_MAX,
  subjectTooShort: SUPPORT_LENGTHS.SUBJECT_MIN,
  messageTooShort: SUPPORT_LENGTHS.MESSAGE_MIN,
  contentTooShort: SUPPORT_LENGTHS.MESSAGE_MIN,
} as const;

const numbersIn = (text: string): number[] =>
  (text.match(/\d+/g) ?? []).map(Number);

describe('support validation copy states the limits of SUPPORT_LENGTHS', () => {
  it('one content limit serves both the user message and the admin reply', () => {
    expect(SUPPORT_LENGTHS.REPLY_MAX).toBe(SUPPORT_LENGTHS.MESSAGE_MAX);
  });

  for (const [locale, common] of Object.entries(LOCALES)) {
    for (const [key, limit] of Object.entries(LIMIT_BY_KEY)) {
      it(`${locale}: validation.support.${key} names ${limit}`, () => {
        const copy: Record<string, string> = common.validation.support;
        const text = copy[key];
        expect(typeof text).toBe('string');
        expect(numbersIn(text ?? '')).toEqual([limit]);
      });
    }
  }
});
