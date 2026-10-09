/**
 * Characterization tests for supportValidators (FWE Wave H, FAZA 1).
 *
 * These lock the CURRENT behavior of the kernel support request validators as the
 * safety net the zod migration (FAZA 2) must preserve — every assertion below is GREEN
 * against the hand-written validators, so a zod rewrite that changes a field's
 * accept/reject decision (or which field carries the error) flips a test. They assert
 * the validation LOGIC (which field is rejected, __isValid), NOT exact i18n message text
 * (brittle): a rejected field = a non-empty error string, an accepted field = empty.
 *
 * Valid/boundary inputs are DERIVED from the SSOT configs (SUPPORT_LENGTHS) and the
 * Prisma-generated enum (SupportThreadStatusValue), not hardcoded, so a cap/enum change
 * in the config moves these in lockstep.
 *
 * SECURITY focus (must survive the zod migration):
 *  - subject/message/content MAX-length caps (DoS / oversized-payload guard).
 *  - blank/whitespace-only floors on free-text (no empty thread/message persisted; for
 *    admin reply, no empty-content notification email sent — see DECISION comments).
 *  - status must be a member of the SupportThreadStatusValue enum (no arbitrary status).
 *
 * Shape mirrors the EXEMPLAR gallery.validation.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { SUPPORT_LENGTHS } from '@kernel/policies/validation.config';
import {
  SupportThreadCategoryValue,
  SupportThreadStatusValue,
} from '@kernel/models/db_models.generated.dto';

const V = VALIDATION_POLICY.validators;

// Helper: a field is "rejected" when its accumulated error string is non-empty.
const rejected = (r: Record<string, unknown>, field: string): boolean =>
  typeof r[field] === 'string' && (r[field] as string).trim().length > 0;

const SOME_STATUS = Object.values(SupportThreadStatusValue)[0] as string;
const SOME_CATEGORY = Object.values(SupportThreadCategoryValue)[0] as string;

// A message/content that clears the MESSAGE_MIN floor without hitting the cap.
const VALID_MESSAGE = 'x'.repeat(SUPPORT_LENGTHS.MESSAGE_MIN);

describe('supportValidators.createSupportThread', () => {
  // S126: the request carries a CATEGORY and one message. The subject left the
  // contract (the server derives the title), so its length limits are no
  // longer input validation.
  const valid = { category: SOME_CATEGORY, message: VALID_MESSAGE };

  it('accepts a well-formed thread', () => {
    expect(V.createSupportThread({ ...valid }).__isValid).toBe(true);
  });

  it('accepts every category of the generated enum', () => {
    for (const category of Object.values(SupportThreadCategoryValue)) {
      expect(V.createSupportThread({ ...valid, category }).__isValid).toBe(
        true
      );
    }
  });

  it('rejects a missing category and a missing message', () => {
    const r = V.createSupportThread({});
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'category')).toBe(true);
    expect(rejected(r, 'message')).toBe(true);
  });

  it('SECURITY: rejects a category outside the enum (unknown, empty, wrong case, non-string)', () => {
    for (const category of ['NOPE', '', 'question', 'NONE', 7, null, {}]) {
      const r = V.createSupportThread({ ...valid, category });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'category')).toBe(true);
    }
  });

  it('a subject sent by an old client is not an error and not required', () => {
    expect(
      V.createSupportThread({ ...valid, subject: 'stary formularz' }).__isValid
    ).toBe(true);
  });

  it('rejects a non-string message (type guard)', () => {
    expect(
      rejected(
        V.createSupportThread({ ...valid, message: {} as unknown as string }),
        'message'
      )
    ).toBe(true);
  });

  it('SECURITY: rejects a blank / whitespace-only message (trimmed floor)', () => {
    const rMessage = V.createSupportThread({ ...valid, message: '\t\n  ' });
    expect(rMessage.__isValid).toBe(false);
    expect(rejected(rMessage, 'message')).toBe(true);
  });

  it('rejects a message below MESSAGE_MIN (too short)', () => {
    const shortMessage = 'x'.repeat(SUPPORT_LENGTHS.MESSAGE_MIN - 1);
    expect(
      rejected(
        V.createSupportThread({ ...valid, message: shortMessage }),
        'message'
      )
    ).toBe(true);
  });

  it('SECURITY: rejects a message over MESSAGE_MAX (too long, raw length)', () => {
    expect(
      rejected(
        V.createSupportThread({
          ...valid,
          message: 'x'.repeat(SUPPORT_LENGTHS.MESSAGE_MAX + 1),
        }),
        'message'
      )
    ).toBe(true);
  });

  it('accepts a message exactly at the MIN and at the MAX boundary', () => {
    for (const length of [
      SUPPORT_LENGTHS.MESSAGE_MIN,
      SUPPORT_LENGTHS.MESSAGE_MAX,
    ]) {
      expect(
        V.createSupportThread({ ...valid, message: 'x'.repeat(length) })
          .__isValid
      ).toBe(true);
    }
  });
});

describe('supportValidators.markSupportThreadRead', () => {
  it('accepts a thread id', () => {
    expect(V.markSupportThreadRead({ thread_id: 't1' }).__isValid).toBe(true);
  });

  it('rejects a missing, empty or non-string thread id', () => {
    for (const body of [{}, { thread_id: '' }, { thread_id: 5 }]) {
      const r = V.markSupportThreadRead(body);
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'thread_id')).toBe(true);
    }
  });
});

describe('supportValidators.addSupportMessage', () => {
  const valid = { thread_id: 't1', content: VALID_MESSAGE };

  it('accepts a well-formed message', () => {
    expect(V.addSupportMessage({ ...valid }).__isValid).toBe(true);
  });

  it('rejects a missing / non-string thread_id', () => {
    expect(
      rejected(V.addSupportMessage({ ...valid, thread_id: '' }), 'thread_id')
    ).toBe(true);
    expect(
      rejected(
        V.addSupportMessage({ ...valid, thread_id: 5 as unknown as string }),
        'thread_id'
      )
    ).toBe(true);
  });

  it('SECURITY: rejects missing / blank / whitespace-only content', () => {
    expect(
      rejected(V.addSupportMessage({ ...valid, content: '' }), 'content')
    ).toBe(true);
    expect(
      rejected(V.addSupportMessage({ ...valid, content: '   ' }), 'content')
    ).toBe(true);
  });

  it('rejects content below MESSAGE_MIN (too short, trimmed)', () => {
    const short = 'x'.repeat(SUPPORT_LENGTHS.MESSAGE_MIN - 1);
    expect(
      rejected(V.addSupportMessage({ ...valid, content: short }), 'content')
    ).toBe(true);
  });

  it('SECURITY: rejects content over MESSAGE_MAX (too long, raw length)', () => {
    const long = 'x'.repeat(SUPPORT_LENGTHS.MESSAGE_MAX + 1);
    expect(
      rejected(V.addSupportMessage({ ...valid, content: long }), 'content')
    ).toBe(true);
  });

  it('accepts content at the MESSAGE_MAX boundary', () => {
    expect(
      V.addSupportMessage({
        ...valid,
        content: 'x'.repeat(SUPPORT_LENGTHS.MESSAGE_MAX),
      }).__isValid
    ).toBe(true);
  });
});

describe('supportValidators.adminSupportReply', () => {
  const valid = { thread_id: 't1', content: VALID_MESSAGE };

  it('accepts a well-formed reply', () => {
    expect(V.adminSupportReply({ ...valid }).__isValid).toBe(true);
  });

  it('rejects a missing thread_id', () => {
    expect(
      rejected(V.adminSupportReply({ ...valid, thread_id: '' }), 'thread_id')
    ).toBe(true);
  });

  it('SECURITY: rejects missing / blank / whitespace-only content (no empty-content notification)', () => {
    expect(
      rejected(V.adminSupportReply({ ...valid, content: '' }), 'content')
    ).toBe(true);
    expect(
      rejected(V.adminSupportReply({ ...valid, content: '  \n ' }), 'content')
    ).toBe(true);
  });

  it('rejects content below MESSAGE_MIN (too short)', () => {
    const short = 'x'.repeat(SUPPORT_LENGTHS.MESSAGE_MIN - 1);
    expect(
      rejected(V.adminSupportReply({ ...valid, content: short }), 'content')
    ).toBe(true);
  });

  it('SECURITY: rejects content over REPLY_MAX (too long, raw length)', () => {
    const long = 'x'.repeat(SUPPORT_LENGTHS.REPLY_MAX + 1);
    expect(
      rejected(V.adminSupportReply({ ...valid, content: long }), 'content')
    ).toBe(true);
  });

  it('accepts content at the REPLY_MAX boundary', () => {
    expect(
      V.adminSupportReply({
        ...valid,
        content: 'x'.repeat(SUPPORT_LENGTHS.REPLY_MAX),
      }).__isValid
    ).toBe(true);
  });
});

describe('supportValidators.getSupportThreadMessages', () => {
  it('requires a string thread_id', () => {
    expect(V.getSupportThreadMessages({ thread_id: 't1' }).__isValid).toBe(
      true
    );
    expect(V.getSupportThreadMessages({ thread_id: '' }).__isValid).toBe(false);
    expect(
      V.getSupportThreadMessages({ thread_id: 1 as unknown as string })
        .__isValid
    ).toBe(false);
  });
});

describe('supportValidators.changeSupportStatus', () => {
  const valid = { thread_id: 't1', status: SOME_STATUS };

  it('accepts a valid thread_id + enum status (no concurrency token)', () => {
    expect(V.changeSupportStatus({ ...valid }).__isValid).toBe(true);
  });

  it('rejects a missing thread_id', () => {
    expect(
      rejected(V.changeSupportStatus({ ...valid, thread_id: '' }), 'thread_id')
    ).toBe(true);
  });

  it('SECURITY: rejects a missing / non-enum status', () => {
    expect(
      rejected(V.changeSupportStatus({ ...valid, status: '' }), 'status')
    ).toBe(true);
    expect(
      rejected(
        V.changeSupportStatus({ ...valid, status: 'NOT_A_STATUS' }),
        'status'
      )
    ).toBe(true);
    expect(
      rejected(
        V.changeSupportStatus({ ...valid, status: 'open' /* wrong case */ }),
        'status'
      )
    ).toBe(true);
  });

  it('accepts every member of SupportThreadStatusValue', () => {
    for (const status of Object.values(SupportThreadStatusValue)) {
      expect(
        V.changeSupportStatus({ thread_id: 't1', status }).__isValid,
        `status=${status}`
      ).toBe(true);
    }
  });

  it('OPTIONAL concurrency token: omitted / null expected_updated_at is accepted', () => {
    expect(V.changeSupportStatus({ ...valid }).__isValid).toBe(true);
    expect(
      V.changeSupportStatus({
        ...valid,
        expected_updated_at: null as unknown as string,
      }).__isValid
    ).toBe(true);
    expect(
      V.changeSupportStatus({ ...valid, expected_updated_at: undefined })
        .__isValid
    ).toBe(true);
  });

  it('accepts a valid Date and a valid ISO-8601 expected_updated_at', () => {
    expect(
      V.changeSupportStatus({
        ...valid,
        expected_updated_at: new Date() as unknown as string,
      }).__isValid
    ).toBe(true);
    expect(
      V.changeSupportStatus({
        ...valid,
        expected_updated_at: new Date().toISOString(),
      }).__isValid
    ).toBe(true);
  });

  it('rejects a malformed / unparseable expected_updated_at', () => {
    const rEmpty = V.changeSupportStatus({ ...valid, expected_updated_at: '' });
    expect(rejected(rEmpty, 'expected_updated_at')).toBe(true);

    const rGarbage = V.changeSupportStatus({
      ...valid,
      expected_updated_at: 'not-a-date',
    });
    expect(rejected(rGarbage, 'expected_updated_at')).toBe(true);

    const rInvalidDate = V.changeSupportStatus({
      ...valid,
      expected_updated_at: new Date('invalid') as unknown as string,
    });
    expect(rejected(rInvalidDate, 'expected_updated_at')).toBe(true);
  });
});
