/**
 * Characterization tests for adminLogsValidators (FWE Wave H, FAZA 1).
 *
 * These lock the CURRENT behavior of the kernel admin-logs request validators as the
 * safety net the zod migration (FAZA 2) must preserve — every assertion below is GREEN
 * against the hand-written validators, so a zod rewrite that changes a field's accept/reject
 * decision (or which field carries the error) flips a test. They assert the validation LOGIC
 * (__isValid + which field is rejected), NOT exact i18n message text (brittle) — a rejected
 * field is asserted via a non-empty error string, an accepted field via an empty one.
 *
 * Valid/boundary inputs are DERIVED from the SSOT configs (VALIDATION_LENGTHS,
 * VALIDATION_PAGINATION, SEND_LOG_TYPES, TIMELINE_EVENT_TYPES), not hardcoded, so a limit
 * change in the config moves these in lockstep.
 *
 * Shape follows the gallery.validation.test.ts exemplar.
 *
 * NOTE on error surfaces (characterized, not "fixed"):
 *  - adminSendLog accumulates EVERY field error into a single `__general` bucket (no
 *    per-field keys), so per-field rejection is asserted via __isValid + __general here.
 *  - adminGetUserTimeline / adminGetLogs DO carry per-field error keys.
 */
import { describe, it, expect } from 'vitest';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { SEND_LOG_TYPES } from '@kernel/domain/admin/send-log.config';
import { TIMELINE_EVENT_TYPES } from '@kernel/domain/admin/admin.config';
import {
  VALIDATION_LENGTHS,
  VALIDATION_PAGINATION,
} from '@kernel/policies/validation.config';
import { LOG_ISSUE_NOTE_MAX_LENGTH } from '@kernel/domain/admin/log-triage.config';
import { VALIDATION_MESSAGES } from '@kernel/domain/i18n/validation.i18n';

const V = VALIDATION_POLICY.validators;

// Helper: a field is "rejected" when its accumulated error string is non-empty.
const rejected = (r: Record<string, unknown>, field: string): boolean =>
  typeof r[field] === 'string' && (r[field] as string).trim().length > 0;

const SOME_LOG_TYPE = SEND_LOG_TYPES[0]; // 'info'

describe('adminLogsValidators.adminSendLog', () => {
  // All required string fields present + payload/user_metadata as (possibly empty) strings.
  const valid = {
    environment: 'production',
    namespace: 'web-1.application.email.handler',
    type: SOME_LOG_TYPE,
    message: 'something happened',
    payload: '{}',
    user_metadata: '{}',
  };

  it('accepts a well-formed log payload', () => {
    const r = V.adminSendLog({ ...valid });
    expect(r.__isValid).toBe(true);
    expect(rejected(r, '__general')).toBe(false);
  });

  it('rejects a non-object / null / undefined data (early return on __general)', () => {
    for (const bad of [null, undefined, 'a string', 42, true]) {
      const r = V.adminSendLog(bad as unknown);
      expect(r.__isValid, `data=${String(bad)}`).toBe(false);
      expect(rejected(r, '__general'), `data=${String(bad)}`).toBe(true);
    }
  });

  it('rejects a missing / empty environment (and over-max environment)', () => {
    expect(V.adminSendLog({ ...valid, environment: '' }).__isValid).toBe(false);
    expect(V.adminSendLog({ ...valid, environment: undefined }).__isValid).toBe(
      false
    );
    expect(
      V.adminSendLog({ ...valid, environment: 123 as unknown as string })
        .__isValid
    ).toBe(false);
    const tooLong = 'x'.repeat(VALIDATION_LENGTHS.LOG_ENVIRONMENT_MAX + 1);
    const r = V.adminSendLog({ ...valid, environment: tooLong });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, '__general')).toBe(true);
  });

  it('accepts an environment exactly at the max length boundary', () => {
    const atMax = 'x'.repeat(VALIDATION_LENGTHS.LOG_ENVIRONMENT_MAX);
    expect(V.adminSendLog({ ...valid, environment: atMax }).__isValid).toBe(
      true
    );
  });

  it('rejects a missing / empty namespace (and over-max namespace)', () => {
    expect(V.adminSendLog({ ...valid, namespace: '' }).__isValid).toBe(false);
    const tooLong = 'x'.repeat(VALIDATION_LENGTHS.LOG_NAMESPACE_MAX + 1);
    expect(V.adminSendLog({ ...valid, namespace: tooLong }).__isValid).toBe(
      false
    );
  });

  it('SECURITY: rejects a type not in SEND_LOG_TYPES (allowlist), accepts every allowed type', () => {
    expect(V.adminSendLog({ ...valid, type: 'critical' }).__isValid).toBe(
      false
    );
    expect(V.adminSendLog({ ...valid, type: 'INFO' }).__isValid).toBe(false); // case-sensitive
    expect(V.adminSendLog({ ...valid, type: '' }).__isValid).toBe(false);
    for (const t of SEND_LOG_TYPES) {
      expect(V.adminSendLog({ ...valid, type: t }).__isValid, `type=${t}`).toBe(
        true
      );
    }
  });

  it('rejects a missing / empty message (and over-max message)', () => {
    expect(V.adminSendLog({ ...valid, message: '' }).__isValid).toBe(false);
    const tooLong = 'x'.repeat(VALIDATION_LENGTHS.LOG_MESSAGE_MAX + 1);
    expect(V.adminSendLog({ ...valid, message: tooLong }).__isValid).toBe(
      false
    );
  });

  it('SURPRISE: payload must be a STRING but an EMPTY string is accepted (only over-max rejected)', () => {
    // No length===0 check on payload — empty string passes, non-string fails.
    expect(V.adminSendLog({ ...valid, payload: '' }).__isValid).toBe(true);
    expect(V.adminSendLog({ ...valid, payload: undefined }).__isValid).toBe(
      false
    );
    expect(
      V.adminSendLog({ ...valid, payload: {} as unknown as string }).__isValid
    ).toBe(false);
    const tooLong = 'x'.repeat(VALIDATION_LENGTHS.LOG_PAYLOAD_MAX + 1);
    expect(V.adminSendLog({ ...valid, payload: tooLong }).__isValid).toBe(
      false
    );
  });

  it('SURPRISE: user_metadata must be a STRING but an EMPTY string is accepted (only over-max rejected)', () => {
    expect(V.adminSendLog({ ...valid, user_metadata: '' }).__isValid).toBe(
      true
    );
    expect(
      V.adminSendLog({ ...valid, user_metadata: undefined }).__isValid
    ).toBe(false);
    const tooLong = 'x'.repeat(VALIDATION_LENGTHS.LOG_USER_METADATA_MAX + 1);
    expect(V.adminSendLog({ ...valid, user_metadata: tooLong }).__isValid).toBe(
      false
    );
  });
});

describe('adminLogsValidators.adminGetUserTimeline', () => {
  const valid = { user_id: 'cuid-user-1' };

  it('accepts a minimal payload with only user_id', () => {
    const r = V.adminGetUserTimeline({ ...valid });
    expect(r.__isValid).toBe(true);
  });

  it('rejects a missing / empty / non-string user_id (field: user_id)', () => {
    for (const bad of ['', undefined, null, 42]) {
      const r = V.adminGetUserTimeline({
        ...valid,
        user_id: bad as unknown as string,
      });
      expect(r.__isValid, `user_id=${String(bad)}`).toBe(false);
      expect(rejected(r, 'user_id'), `user_id=${String(bad)}`).toBe(true);
    }
  });

  it('OPTIONAL: omitted page/limit/event_type are NOT validated', () => {
    // Only user_id present → valid, optional fields skipped entirely.
    expect(V.adminGetUserTimeline({ user_id: 'u1' }).__isValid).toBe(true);
  });

  it('CHARACTERIZED: null page/limit/event_type are treated as "not provided" (skipped)', () => {
    const r = V.adminGetUserTimeline({
      ...valid,
      page: null as unknown as number,
      limit: null as unknown as number,
      event_type: null as unknown as string,
    });
    expect(r.__isValid).toBe(true);
  });

  it('PAGE: rejects non-number, below PAGE_MIN, and non-integer; accepts at PAGE_MIN', () => {
    expect(
      rejected(
        V.adminGetUserTimeline({ ...valid, page: '1' as unknown as number }),
        'page'
      )
    ).toBe(true);
    expect(
      rejected(
        V.adminGetUserTimeline({
          ...valid,
          page: VALIDATION_PAGINATION.PAGE_MIN - 1,
        }),
        'page'
      )
    ).toBe(true);
    expect(
      rejected(V.adminGetUserTimeline({ ...valid, page: 1.5 }), 'page')
    ).toBe(true);
    expect(
      V.adminGetUserTimeline({ ...valid, page: VALIDATION_PAGINATION.PAGE_MIN })
        .__isValid
    ).toBe(true);
  });

  it('LIMIT: rejects non-number, below min, above max, non-integer; accepts both bounds', () => {
    expect(
      rejected(
        V.adminGetUserTimeline({ ...valid, limit: '10' as unknown as number }),
        'limit'
      )
    ).toBe(true);
    expect(
      rejected(
        V.adminGetUserTimeline({
          ...valid,
          limit: VALIDATION_PAGINATION.LIMIT_MIN - 1,
        }),
        'limit'
      )
    ).toBe(true);
    expect(
      rejected(
        V.adminGetUserTimeline({
          ...valid,
          limit: VALIDATION_PAGINATION.LIMIT_MAX + 1,
        }),
        'limit'
      )
    ).toBe(true);
    expect(
      rejected(V.adminGetUserTimeline({ ...valid, limit: 10.5 }), 'limit')
    ).toBe(true);
    expect(
      V.adminGetUserTimeline({
        ...valid,
        limit: VALIDATION_PAGINATION.LIMIT_MIN,
      }).__isValid
    ).toBe(true);
    expect(
      V.adminGetUserTimeline({
        ...valid,
        limit: VALIDATION_PAGINATION.LIMIT_MAX,
      }).__isValid
    ).toBe(true);
  });

  it('SECURITY: event_type must be in TIMELINE_EVENT_TYPES allowlist; non-string + unknown rejected', () => {
    expect(
      rejected(
        V.adminGetUserTimeline({
          ...valid,
          event_type: 42 as unknown as string,
        }),
        'event_type'
      )
    ).toBe(true);
    expect(
      rejected(
        V.adminGetUserTimeline({ ...valid, event_type: 'NOT_A_TYPE' }),
        'event_type'
      )
    ).toBe(true);
    for (const et of TIMELINE_EVENT_TYPES) {
      expect(
        V.adminGetUserTimeline({ ...valid, event_type: et }).__isValid,
        `event_type=${et}`
      ).toBe(true);
    }
  });
});

describe('adminLogsValidators.adminGetLogs', () => {
  it('accepts an empty payload (environment is optional)', () => {
    expect(V.adminGetLogs({}).__isValid).toBe(true);
  });

  it('accepts an environment from the allowlist', () => {
    expect(V.adminGetLogs({ environment: 'PRODUCTION' }).__isValid).toBe(true);
  });

  // Zacieśnione 2026-08-19 z `z.string()` do enuma (patrz DECISION w
  // admin-logs.validation.ts). Wartości filtra pochodzą z listy w panelu, więc
  // dowolny string był luźniejszy niż potrzeba; rekordy o historycznym
  // środowisku nadal widać przy braku filtru.
  it('rejects an environment outside the allowlist (case-sensitive)', () => {
    const r = V.adminGetLogs({ environment: 'production' as never });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'environment')).toBe(true);
  });

  it('rejects a non-string environment when provided (field: environment)', () => {
    const r = V.adminGetLogs({ environment: 123 as unknown as never });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'environment')).toBe(true);
  });

  it('accepts the new application and type dimensions from their allowlists', () => {
    expect(
      V.adminGetLogs({ application: 'backend', type: 'error' }).__isValid
    ).toBe(true);
    expect(V.adminGetLogs({ application: 'nope' as never }).__isValid).toBe(
      false
    );
    expect(V.adminGetLogs({ type: 'fatal' as never }).__isValid).toBe(false);
  });

  it('CHARACTERIZED: undefined environment is skipped, but null is rejected (typeof null !== string)', () => {
    expect(V.adminGetLogs({ environment: undefined }).__isValid).toBe(true);
    // null !== undefined, so the optional-guard does NOT skip it → typeof check fails.
    expect(
      V.adminGetLogs({ environment: null as unknown as never }).__isValid
    ).toBe(false);
  });
});

describe('adminLogsValidators.adminSetLogIssueStatus', () => {
  const FINGERPRINT = 'a'.repeat(32);
  const valid = { fingerprint: FINGERPRINT, status: 'known' } as const;

  it('accepts a well-formed status write without a note', () => {
    expect(V.adminSetLogIssueStatus({ ...valid }).__isValid).toBe(true);
  });

  it('rejects a fingerprint that is not 32 lowercase hex chars', () => {
    for (const bad of ['A'.repeat(32), 'a'.repeat(31), 'zz', 42]) {
      const r = V.adminSetLogIssueStatus({ ...valid, fingerprint: bad });
      expect(r.__isValid, `fingerprint=${String(bad)}`).toBe(false);
      expect(rejected(r, 'fingerprint')).toBe(true);
    }
  });

  it('rejects a status outside LOG_ISSUE_STATUSES', () => {
    const r = V.adminSetLogIssueStatus({ ...valid, status: 'regressed' });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'status')).toBe(true);
  });

  // Notatka: pusty string jest LEGALNY — to jawne skasowanie notatki
  // (adminSetLogIssueStatus_IO rozróżnia brak klucza od pustego stringa).
  it('accepts an empty note (explicit clear) and a note at the max length', () => {
    expect(V.adminSetLogIssueStatus({ ...valid, note: '' }).__isValid).toBe(
      true
    );
    expect(
      V.adminSetLogIssueStatus({
        ...valid,
        note: 'x'.repeat(LOG_ISSUE_NOTE_MAX_LENGTH),
      }).__isValid
    ).toBe(true);
  });

  it('rejects an over-max note with the i18n key (not a zod default)', () => {
    const r = V.adminSetLogIssueStatus({
      ...valid,
      note: 'x'.repeat(LOG_ISSUE_NOTE_MAX_LENGTH + 1),
    });
    expect(r.__isValid).toBe(false);
    expect(r.note).toContain(VALIDATION_MESSAGES.logIssueStatus.noteTooLong);
  });

  // Regresja: `note` bez własnego klucza typu wypuszczał surowy angielski komunikat
  // zod („Invalid input") prosto do klienta zamiast tokenu i18n.
  it('rejects a non-string note with the i18n key (not a zod default)', () => {
    for (const bad of [5, {}, [], true]) {
      const r = V.adminSetLogIssueStatus({ ...valid, note: bad });
      expect(r.__isValid, `note=${JSON.stringify(bad)}`).toBe(false);
      expect(r.note, `note=${JSON.stringify(bad)}`).toContain(
        VALIDATION_MESSAGES.logIssueStatus.noteMustBeString
      );
    }
  });
});
