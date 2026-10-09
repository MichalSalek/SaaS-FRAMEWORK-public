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
    // DECISION: hasUnpairedSurrogate / countCodePoints ignore U+0000.
    // containsNullByte in HTTPRequestHandlerMiddleware rejects it first.
    const r = V.messagingSend({ pair_id: 'p', content: 'ok\u0000ok' });
    expect(r.__isValid).toBe(true);
  });
});

describe('clientUpsertCrmNote — 2000 code-point cap', () => {
  it('accepts CRM_NOTE_MAX emoji', () => {
    const r = V.clientUpsertCrmNote({
      client_user_id: 'c',
      note: EMOJI.repeat(VISIT_CONFIG.CRM_NOTE_MAX),
    });
    expect(r.__isValid).toBe(true);
  });

  it('rejects CRM_NOTE_MAX+1 emoji', () => {
    const r = V.clientUpsertCrmNote({
      client_user_id: 'c',
      note: EMOJI.repeat(VISIT_CONFIG.CRM_NOTE_MAX + 1),
    });
    expect(r.__isValid).toBe(false);
    expect(fieldToken(r, 'note')).toContain(M.visit.crmNoteTooLong);
  });

  it('lone surrogate → invalidCharacters', () => {
    const r = V.clientUpsertCrmNote({
      client_user_id: 'c',
      note: '\uD83D',
    });
    expect(r.__isValid).toBe(false);
    expect(fieldToken(r, 'note')).toContain(M.general.invalidCharacters);
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
