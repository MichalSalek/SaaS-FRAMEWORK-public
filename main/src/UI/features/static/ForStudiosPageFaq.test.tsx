import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AbstractIntlMessages } from 'next-intl';
import { PRICING_LIMITS_SSOT } from '@kernel/policies/pricing.policy';
import type { IntlMessages } from '../../../types/i18n';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import { buildStudioFaqJsonLd, type FaqJsonLd } from './ForStudiosPageJsonLd';
import { ForStudiosFaqSectionOrganism } from './ForStudiosPageSections.organism';
import {
  createStudioFaqAnswerFormatter,
  formatStudioFaqAnswer,
  STUDIO_FAQ_INVITED_STYLIST_ANSWER_KEY,
  STUDIO_INVITED_STYLIST_LIMIT,
} from './ForStudiosPageFaq';

const LOCALES = ['pl', 'en', 'de'] as const;
type Locale = (typeof LOCALES)[number];

function messagesFor(locale: Locale): IntlMessages {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), 'src', 'locales', locale, 'common.json'),
      'utf8'
    )
  ) as IntlMessages;
}

describe('For Studios invited-stylists FAQ', () => {
  it('formats the visible and JSON-LD answer from the kernel member limit', () => {
    const messages = messagesFor('pl');
    const expected = formatStudioFaqAnswer(
      messages,
      'pl',
      STUDIO_FAQ_INVITED_STYLIST_ANSWER_KEY
    );

    expect(STUDIO_INVITED_STYLIST_LIMIT).toBe(
      PRICING_LIMITS_SSOT.STUDIO.max_staff_members
    );
    expect(STUDIO_INVITED_STYLIST_LIMIT).toBe(9);
    expect(expected).toContain(
      String(PRICING_LIMITS_SSOT.STUDIO.max_staff_members)
    );
    expect(expected).not.toContain('{count}');

    renderWithProviders(<ForStudiosFaqSectionOrganism />, {
      messages: messages as unknown as AbstractIntlMessages,
      locale: 'pl',
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: messages.static.forStudios.faq.q1,
      })
    );
    expect(screen.getByText(expected).textContent).toBe(expected);

    const faqJsonLd = buildStudioFaqJsonLd(messages, 'pl') as FaqJsonLd;
    expect(faqJsonLd.mainEntity[0]?.acceptedAnswer.text).toBe(expected);
    expect(faqJsonLd.mainEntity[0]?.acceptedAnswer.text).not.toContain(
      '{count}'
    );
  });

  it.each(LOCALES)(
    '%s answer formatter resolves the shared count and preserves the remaining copy',
    locale => {
      const messages = messagesFor(locale);
      const formatAnswer = createStudioFaqAnswerFormatter(messages, locale);
      const answer = formatAnswer(STUDIO_FAQ_INVITED_STYLIST_ANSWER_KEY);
      const source = messages.static.forStudios.faq.a1;

      expect(answer).not.toContain('{count}');
      expect(answer).toBe(
        source.replace(
          '{count}',
          String(PRICING_LIMITS_SSOT.STUDIO.max_staff_members)
        )
      );
      expect(formatAnswer('faq.a2')).toBe(messages.static.forStudios.faq.a2);
    }
  );
});
