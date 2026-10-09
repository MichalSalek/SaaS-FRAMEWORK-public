/**
 * Email Template i18n — type-safe access to email locale JSON files.
 *
 * SRP: Load locale JSON, expose typed getters for body pieces, subjects, and
 * footer labels. Falls back to `pl` (default locale) for missing keys.
 *
 * JSON files live in `.shared-kernel/domain/email/locales/`:
 *   - email-i18n.pl.json (Polish — primary)
 *   - email-i18n.en.json (English)
 *   - email-i18n.de.json (German, formal "Sie")
 *
 * Each file has shape:
 *   {
 *     "bodies": { [templateId]: { [piece]: string } },
 *     "subjects": { [subjectKey]: string },
 *     "footer": { unsubscribe, unsubscribeLink, companyInfo }
 *   }
 *
 * IMPORTANT: PL is the single source of truth for the schema. EN/DE files must
 * have the SAME keys — parity is enforced by the `email-locale-parity.sh` audit
 * (pre-push ratchet), NOT by TypeScript (EN/DE are cast to `typeof PL`).
 */

import type { LocaleType } from '@kernel/domain/i18n/i18n.config';
import emailI18nPl from '@kernel/domain/email/locales/email-i18n.pl.json';
import emailI18nEn from '@kernel/domain/email/locales/email-i18n.en.json';
import emailI18nDe from '@kernel/domain/email/locales/email-i18n.de.json';

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

/**
 * Schema is inferred from the PL JSON file (primary locale).
 * EN and DE are cast to match this shape — missing keys at runtime fall back
 * to the PL value via `bodies[locale]?.[key] ?? bodies.pl[key]`.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Using `typeof emailI18nPl` instead of a hand-written interface lets the JSON
 * be the source of truth. Adding a new template key in PL JSON automatically
 * widens the union types below; missing the same key in EN/DE is NOT a TS error
 * (the casts below suppress it) — at runtime it is a SILENT fallback to the PL
 * value, by design (per-locale rollout; no runtime validator exists on purpose).
 * Trade-off accepted: drift-tolerant runtime vs strict compile-time parity.
 * Drift IS caught, but at the gate, not at startup: the
 * `tests/audit/email-locale-parity.sh` audit (run-all / pre-push ratchet) fails
 * on any leaf-key or empty-value divergence between pl/en/de JSON files.
 */
type EmailI18nShape = typeof emailI18nPl;

export type BodyTemplateKey = keyof EmailI18nShape['bodies'];

/**
 * Union of all piece keys across all body templates.
 * Use this for getBodyPiece(); not every template has every piece.
 */
export type BodyPieceKey =
  | 'greeting'
  | 'greetingWithName'
  | 'heading'
  | 'headingWithName'
  | 'headingBan'
  | 'preheader'
  | 'preheaderNoOffer'
  | 'preheaderBan'
  | 'body'
  | 'bodyInactive'
  | 'bodyNoOffer'
  | 'bodyZero'
  | 'offerApplied'
  | 'cta'
  | 'ctaInactive'
  | 'ctaNoOffer'
  | 'ctaPhoto'
  | 'secondaryCta'
  | 'ps'
  | 'ignoreNote'
  | 'copyLinkLabel'
  | 'offerLabel'
  | 'offerHeadline'
  | 'offerExpiry'
  | 'offerFinePrint'
  | 'supportNote'
  | 'supportCta'
  | 'introHide'
  | 'introDelete'
  | 'introWarn'
  | 'introBan'
  | 'adminNoteLabel';

// ────────────────────────────────────────────
// Locale map
// ────────────────────────────────────────────

const LOCALE_MAP: Record<LocaleType, EmailI18nShape> = {
  pl: emailI18nPl,
  en: emailI18nEn as EmailI18nShape,
  de: emailI18nDe as EmailI18nShape,
};

const DEFAULT_LOCALE: LocaleType = 'pl';

// ────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────

/**
 * Fetch a body-piece string for a template + piece key in a given locale.
 *
 * Resolution order:
 *   1. requested locale + piece
 *   2. requested locale + default piece (only when piece is 'greeting' fallback for missing 'greetingWithName')
 *   3. PL fallback (default locale)
 *   4. empty string
 *
 * Returns the raw template (with `{{var}}` placeholders preserved). Caller is
 * responsible for interpolation + HTML escaping of user-supplied vars.
 *
 * Author-controlled static text is NOT escaped — it may contain hand-authored
 * HTML entities (e.g., `&amp;`) or be embedded verbatim in HTML.
 */
export const getBodyPiece = (
  templateKey: BodyTemplateKey,
  pieceKey: BodyPieceKey,
  locale: LocaleType
): string => {
  const localized = LOCALE_MAP[locale]?.bodies?.[templateKey] as
    Record<string, string> | undefined;
  const fallback = LOCALE_MAP[DEFAULT_LOCALE].bodies[templateKey] as Record<
    string,
    string
  >;

  const value = localized?.[pieceKey] ?? fallback?.[pieceKey];
  return value ?? '';
};

export type StatsForm =
  | 'worksOne'
  | 'worksFew'
  | 'worksMany'
  | 'clientsOne'
  | 'clientsFew'
  | 'clientsMany';

type StatsShape = Record<StatsForm | 'joiner', string>;

export const getStatsLabels = (locale: LocaleType): StatsShape => {
  const localized = (
    LOCALE_MAP[locale] as EmailI18nShape & { stats?: StatsShape }
  ).stats;
  const fallback = (
    LOCALE_MAP[DEFAULT_LOCALE] as EmailI18nShape & {
      stats?: StatsShape;
    }
  ).stats;
  return (
    localized ??
    fallback ?? {
      worksOne: '',
      worksFew: '',
      worksMany: '',
      clientsOne: '',
      clientsFew: '',
      clientsMany: '',
      joiner: ', ',
    }
  );
};
