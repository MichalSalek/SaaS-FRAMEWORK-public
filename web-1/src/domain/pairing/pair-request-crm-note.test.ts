import { describe, expect, it } from 'vitest';
import { VISIT_CONFIG } from '@kernel/domain/visit/visit.config';
import { I18N_CONFIG } from '@kernel/domain/i18n/i18n.config';
import { pairRequestCrmNoteWrite } from './pair-request-crm-note';

const request = {
  crm_note: '  Existing CRM\r\ntext  ',
  crm_note_updated_at: null,
  request_place: 'Kraków, Podgórze',
  request_note: 'Thursday\n15:00',
  paired_at: new Date('2026-10-23T23:30:00.000Z'),
};
const activatedAt = new Date('2026-10-24T10:00:00.000Z');

describe('pairRequestCrmNoteWrite', () => {
  it.each([
    [
      'pl',
      'Prośba klientki o połączenie',
      'Przybliżona lokalizacja',
      'Wiadomość klientki',
    ],
    [
      'en',
      'Client connection request',
      'Approximate location',
      'Client message',
    ],
    [
      'de',
      'Verbindungsanfrage der Kundin',
      'Ungefährer Standort',
      'Nachricht der Kundin',
    ],
  ] as const)(
    'labels the client-authored block in %s',
    (locale, heading, place, note) => {
      const result = pairRequestCrmNoteWrite(request, locale, activatedAt);
      expect(result.crm_note).toBe(
        `${request.crm_note}\n\n${heading} (${new Intl.DateTimeFormat(locale, {
          dateStyle: 'medium',
          timeZone: I18N_CONFIG.timezone,
        }).format(
          request.paired_at
        )})\n${place}: ${request.request_place}\n${note}: ${request.request_note}`
      );
      expect(result.crm_note_updated_at).toEqual(activatedAt);
      expect(result).not.toHaveProperty('important_note');
    }
  );

  it('preserves a full baseline and every code point of the request beyond the manual cap', () => {
    const baseline = '😀'.repeat(VISIT_CONFIG.CRM_NOTE_MAX);
    const result = pairRequestCrmNoteWrite(
      { ...request, crm_note: baseline },
      'en',
      activatedAt
    );
    expect(
      result.crm_note?.startsWith(`${baseline}\n\nClient connection request`)
    ).toBe(true);
    expect(result.crm_note?.endsWith('Client message: Thursday\n15:00')).toBe(
      true
    );
    expect(Array.from(result.crm_note ?? '').length).toBeGreaterThan(
      VISIT_CONFIG.CRM_NOTE_MAX
    );
  });

  it('writes nothing when there is no request context', () => {
    expect(
      pairRequestCrmNoteWrite(
        { ...request, request_place: null, request_note: null },
        'pl',
        activatedAt
      )
    ).toEqual({});
  });

  it('advances the retained CRM revision when an append lands in the same millisecond', () => {
    const result = pairRequestCrmNoteWrite(
      { ...request, crm_note_updated_at: activatedAt },
      'en',
      activatedAt
    );
    expect(result.crm_note_updated_at).toEqual(
      new Date(activatedAt.getTime() + 1)
    );
  });

  it('dates a request at the local midnight boundary using the shared timezone', () => {
    const result = pairRequestCrmNoteWrite(
      { ...request, paired_at: new Date('2026-07-23T22:30:00.000Z') },
      'pl',
      activatedAt
    );
    expect(result.crm_note).toContain(
      'Prośba klientki o połączenie (24 lip 2026)'
    );
  });

  it('supports a request with only one field and no previous CRM note', () => {
    const result = pairRequestCrmNoteWrite(
      { ...request, crm_note: null, request_note: null },
      'de',
      activatedAt
    );
    expect(result.crm_note).toMatch(/^Verbindungsanfrage/);
    expect(result.crm_note).toContain('Ungefährer Standort: Kraków, Podgórze');
    expect(result.crm_note).not.toContain('Nachricht');
  });
});
