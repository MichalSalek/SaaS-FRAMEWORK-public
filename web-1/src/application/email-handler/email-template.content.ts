/**
 * Email Template Content — i18n subjects + footer labels (backward-compat layer)
 *
 * SRP: Thin re-export layer for SUBJECTS, FOOTER_LABELS, BODY_TEMPLATES.
 * Actual data lives in JSON files under `.shared-kernel/domain/email/locales/`.
 *
 * Why this file still exists: existing callers import { SUBJECTS, FOOTER_LABELS,
 * BODY_TEMPLATES } from here. We expose them as derived consts to avoid breaking
 * those imports. New code should prefer `email-template.i18n.ts` getBodyPiece()
 * directly for proper per-locale fallback handling.
 */

import type { LocaleType } from '@kernel/domain/i18n/i18n.config';
import emailI18nPl from '@kernel/domain/email/locales/email-i18n.pl.json';
import emailI18nEn from '@kernel/domain/email/locales/email-i18n.en.json';
import emailI18nDe from '@kernel/domain/email/locales/email-i18n.de.json';

// Re-export body templates for single import point in renderer
export { BODY_TEMPLATES } from './email-template.registry';
export type { BodyGenerator } from './email-template.bodies';

// ────────────────────────────────────────────
// Subject lines (derived from JSON for back-compat API)
// ────────────────────────────────────────────

const buildSubjectsLookup = (): Record<string, Record<LocaleType, string>> => {
  const out: Record<string, Record<LocaleType, string>> = {};
  for (const key of Object.keys(emailI18nPl.subjects)) {
    const pl = (emailI18nPl.subjects as Record<string, string>)[key] ?? '';
    const en = (emailI18nEn.subjects as Record<string, string>)[key] ?? pl;
    const de = (emailI18nDe.subjects as Record<string, string>)[key] ?? pl;
    out[key] = { pl, en, de };
  }
  return out;
};

export const SUBJECTS: Record<
  string,
  Record<LocaleType, string>
> = buildSubjectsLookup();

// ────────────────────────────────────────────
// Footer labels (derived from JSON)
// ────────────────────────────────────────────

export const FOOTER_LABELS: Record<
  LocaleType,
  {
    unsubscribe: string;
    unsubscribeLink: string;
    companyInfo: string;
  }
> = {
  pl: emailI18nPl.footer,
  en: emailI18nEn.footer,
  de: emailI18nDe.footer,
};
