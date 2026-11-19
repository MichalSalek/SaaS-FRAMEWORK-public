import { createTranslator, type AbstractIntlMessages } from 'next-intl';
import { PRICING_LIMITS_SSOT } from '@kernel/policies/pricing.policy';
import type { IntlMessages } from '../../../types/i18n';

export const STUDIO_FAQ_ANSWER_NAMESPACE = 'static.forStudios';
export const STUDIO_FAQ_INVITED_STYLIST_ANSWER_KEY = 'faq.a1';
export const STUDIO_INVITED_STYLIST_LIMIT =
  PRICING_LIMITS_SSOT.STUDIO.max_staff_members;

type StudioFaqTranslator = (
  key: string,
  values?: Readonly<Record<string, number>>
) => string;

function createStudioFaqTranslator(
  messages: IntlMessages,
  locale: string
): StudioFaqTranslator {
  return createTranslator({
    locale,
    messages: messages as unknown as AbstractIntlMessages,
    namespace: STUDIO_FAQ_ANSWER_NAMESPACE,
  }) as unknown as StudioFaqTranslator;
}

/** Format the same Studio FAQ answer in the visible page and its JSON-LD mirror. */
export function createStudioFaqAnswerFormatter(
  messages: IntlMessages,
  locale: string
): (answerKey: string) => string {
  const translate = createStudioFaqTranslator(messages, locale);
  return answerKey =>
    translate(
      answerKey,
      answerKey === STUDIO_FAQ_INVITED_STYLIST_ANSWER_KEY
        ? { count: STUDIO_INVITED_STYLIST_LIMIT }
        : undefined
    );
}

/** Build-time convenience for a single FAQ answer, including the shared kernel count. */
export function formatStudioFaqAnswer(
  messages: IntlMessages,
  locale: string,
  answerKey: string
): string {
  return createStudioFaqAnswerFormatter(messages, locale)(answerKey);
}
