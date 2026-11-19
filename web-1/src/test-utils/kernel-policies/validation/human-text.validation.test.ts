/**
 * Human-text validators — code-point length + unpaired-surrogate reject (D5).
 *
 * Caps come from SSOT configs (MESSAGING_LENGTHS, VISIT_CONFIG). NUL (U+0000)
 * is the middleware null-byte-guard's job, not these validators.
 */

import { describe, it, expect } from 'vitest';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { MESSAGING_LENGTHS } from '@kernel/policies/validation.config';
import { VISIT_CONFIG } from '@kernel/domain/visit/visit.config';
import { VALIDATION_MESSAGES } from '@kernel/domain/i18n/validation.i18n';

const V = VALIDATION_POLICY.validators;
const M = VALIDATION_MESSAGES;

const fieldToken = (r: Record<string, unknown>, field: string): string =>
  typeof r[field] === 'string' ? (r[field] as string) : '';

const EMOJI = '😀';
const FLAG = '🇵🇱';

describe('messagingSend — code points and unpaired surrogates', () => {
  it('accepts CONTENT_MAX emoji (each 2 UTF-16 units, 1 code point)', () => {
    const r = V.messagingSend({
      pair_id: 'p',
      content: EMOJI.repeat(MESSAGING_LENGTHS.CONTENT_MAX),
    });
    expect(r.__isValid).toBe(true);
  });

  it('rejects CONTENT_MAX+1 emoji as contentTooLong', () => {
    const r = V.messagingSend({
      pair_id: 'p',
      content: EMOJI.repeat(MESSAGING_LENGTHS.CONTENT_MAX + 1),
    });
    expect(r.__isValid).toBe(false);
    expect(fieldToken(r, 'content')).toContain(M.messaging.contentTooLong);
  });

  it('a flag emoji counts 2 code points', () => {
    expect(VALIDATION_POLICY.utils.countCodePoints(FLAG)).toBe(2);
  });

  it('lone high surrogate → validation.general.invalidCharacters', () => {
    const r = V.messagingSend({ pair_id: 'p', content: '\uD83D' });
    expect(r.__isValid).toBe(false);
    expect(fieldToken(r, 'content')).toContain(M.general.invalidCharacters);
  });

  it('lone low surrogate → validation.general.invalidCharacters', () => {
    const r = V.messagingSend({ pair_id: 'p', content: '\uDC00' });
    expect(r.__isValid).toBe(false);
    expect(fieldToken(r, 'content')).toContain(M.general.invalidCharacters);
  });

  it('NUL byte is the middleware guards job, not the validators', () => {
    // hasUnpairedSurrogate / countCodePoints ignore U+0000: containsNullByte in
    // HTTPRequestHandlerMiddleware rejects it first.
    const r = V.messagingSend({ pair_id: 'p', content: 'ok\u0000ok' });
    expect(r.__isValid).toBe(true);
  });
});

describe('clientUpsertCrmNote — dynamic persisted-baseline cap', () => {
  it('accepts CRM_NOTE_MAX emoji', () => {
    const r = V.clientUpsertCrmNote({
      client_user_id: 'c',
      note: EMOJI.repeat(VISIT_CONFIG.CRM_NOTE_MAX),
    });
    expect(r.__isValid).toBe(true);
  });

  it('accepts over-base text at the contract boundary for the operation to check against its persisted baseline', () => {
    const r = V.clientUpsertCrmNote({
      client_user_id: 'c',
      note: EMOJI.repeat(VISIT_CONFIG.CRM_NOTE_MAX + 1),
    });
    expect(r.__isValid).toBe(true);
  });

  it('lone surrogate → invalidCharacters', () => {
    const r = V.clientUpsertCrmNote({
      client_user_id: 'c',
      note: '\uD83D',
    });
    expect(r.__isValid).toBe(false);
    expect(fieldToken(r, 'note')).toContain(M.general.invalidCharacters);
  });

  it('accepts a nullable ISO baseline revision and rejects a malformed revision', () => {
    for (const revision of [null, '2026-10-24T10:00:00.000Z']) {
      expect(
        V.clientUpsertCrmNote({
          client_user_id: 'c',
          note: 'draft',
          expected_updated_at: revision,
        }).__isValid
      ).toBe(true);
    }
    const result = V.clientUpsertCrmNote({
      client_user_id: 'c',
      note: 'draft',
      expected_updated_at: 'yesterday',
    });
    expect(result.__isValid).toBe(false);
    expect(fieldToken(result, 'expected_updated_at')).toContain(
      M.visit.crmNoteChanged
    );
  });
});

describe('clientUpsertImportantNote — 200 code-point cap', () => {
  it('accepts IMPORTANT_NOTE_MAX emoji and an empty note (clears)', () => {
    expect(
      V.clientUpsertImportantNote({
        client_user_id: 'c',
        note: EMOJI.repeat(VISIT_CONFIG.IMPORTANT_NOTE_MAX),
      }).__isValid
    ).toBe(true);
    expect(
      V.clientUpsertImportantNote({ client_user_id: 'c', note: '' }).__isValid
    ).toBe(true);
  });

  it('rejects IMPORTANT_NOTE_MAX+1 emoji', () => {
    const r = V.clientUpsertImportantNote({
      client_user_id: 'c',
      note: EMOJI.repeat(VISIT_CONFIG.IMPORTANT_NOTE_MAX + 1),
    });
    expect(r.__isValid).toBe(false);
    expect(fieldToken(r, 'note')).toContain(M.visit.importantNoteTooLong);
  });

  it('a missing client id is rejected', () => {
    const r = V.clientUpsertImportantNote({ note: 'Uczulenie' });
    expect(r.__isValid).toBe(false);
  });
});

describe('updateVisitNote — 1000 code-point cap', () => {
  it('accepts SERVICE_NOTE_MAX emoji', () => {
    const r = V.updateVisitNote({
      visit_id: 'v',
      service_note: EMOJI.repeat(VISIT_CONFIG.SERVICE_NOTE_MAX),
    });
    expect(r.__isValid).toBe(true);
  });

  it('rejects SERVICE_NOTE_MAX+1 emoji', () => {
    const r = V.updateVisitNote({
      visit_id: 'v',
      service_note: EMOJI.repeat(VISIT_CONFIG.SERVICE_NOTE_MAX + 1),
    });
    expect(r.__isValid).toBe(false);
    expect(fieldToken(r, 'service_note')).toContain(M.visit.serviceNoteTooLong);
  });

  it('lone surrogate → invalidCharacters', () => {
    const r = V.updateVisitNote({
      visit_id: 'v',
      service_note: '\uDC00',
    });
    expect(r.__isValid).toBe(false);
    expect(fieldToken(r, 'service_note')).toContain(
      M.general.invalidCharacters
    );
  });
});

describe('hide / unhide / deleteCrmNote — required tokens', () => {
  it('messagingHideConversation missing pair_id → pairIdRequired', () => {
    const r = V.messagingHideConversation({});
    expect(r.__isValid).toBe(false);
    expect(fieldToken(r, 'pair_id')).toContain(M.messaging.pairIdRequired);
  });

  it('messagingUnhideConversation missing pair_id → pairIdRequired', () => {
    const r = V.messagingUnhideConversation({});
    expect(r.__isValid).toBe(false);
    expect(fieldToken(r, 'pair_id')).toContain(M.messaging.pairIdRequired);
  });

  it('clientDeleteCrmNote missing client_user_id → clientUserIdRequired', () => {
    const r = V.clientDeleteCrmNote({});
    expect(r.__isValid).toBe(false);
    expect(fieldToken(r, 'client_user_id')).toContain(
      M.visit.clientUserIdRequired
    );
  });
});
