import { describe, it, expect } from 'vitest';
import { renderEmailTemplate } from './email-template.renderer';

// German follows DIN 5008 and writes "20 %" with a non-breaking space.
const DISCOUNT = /20\s?%/;

const baseVars = {
  displayName: 'Anna Kowalska',
  planName: 'Pro',
  galleryCount: '12',
};

describe('offer subjects follow the issued code', () => {
  it.each([
    ['trial-last-day', 'email.trial.d29LastDay.subject'],
    ['trial-winback', 'email.trial.d37Winback.subject'],
    ['cancel-d7-winback', 'email.cancel.d7.subject'],
    ['winback-deletion-d60', 'email.winback.deletionD60.subject'],
  ])('%s: discount in the subject only with a code', (templateId, key) => {
    for (const locale of ['pl', 'en', 'de'] as const) {
      const withCode = renderEmailTemplate(
        templateId,
        // D29 carries the discount as an applied flag next to the code.
        { ...baseVars, offerCode: 'ANNA-7K2Q', offerApplied: '1' },
        locale,
        'https://example.test/unsubscribe',
        key
      );
      const withoutCode = renderEmailTemplate(
        templateId,
        baseVars,
        locale,
        'https://example.test/unsubscribe',
        key
      );
      expect(withCode.subject).toMatch(DISCOUNT);
      expect(withCode.text).toMatch(DISCOUNT);
      expect(withoutCode.subject).not.toMatch(DISCOUNT);
      expect(withoutCode.subject).not.toBe('');
      // Body, offer card, CTA and P.S. must all follow the missing code.
      expect(withoutCode.text).not.toMatch(DISCOUNT);
    }
  });

  it('a nameless account gets no leading comma in the subject', () => {
    for (const locale of ['pl', 'en', 'de'] as const) {
      const rendered = renderEmailTemplate(
        'trial-last-day',
        { ...baseVars, displayName: '' },
        locale,
        'https://example.test/unsubscribe',
        'email.trial.d29LastDay.subject'
      );
      expect(rendered.subject).not.toMatch(/^\s*,/);
      expect(rendered.subject.charAt(0)).toBe(
        rendered.subject.charAt(0).toLocaleUpperCase(locale)
      );
    }
  });

  it('subjects without a no-offer variant are untouched', () => {
    const rendered = renderEmailTemplate(
      'trial-ended',
      baseVars,
      'pl',
      'https://example.test/unsubscribe',
      'email.trial.d30Ended.subject'
    );
    expect(rendered.subject).toBe(
      'Okres próbny zakończony. Konto korzysta z planu Free.'
    );
  });
});
