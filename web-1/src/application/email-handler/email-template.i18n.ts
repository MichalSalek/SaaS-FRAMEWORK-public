import { resolveSessionExpiryText } from '@kernel/domain/session-container/session-container.policy-text';
/**
 * Email Template i18n: type-safe access to the e-mail locale JSON files.
 *
 * Loads locale JSON and exposes typed getters for body pieces, subjects and footer labels. Falls
 * back to `pl` (default locale) for missing keys. Files live in
 * `.shared-kernel/domain/email/locales/` (email-i18n.{pl,en,de}.json; DE uses formal "Sie") with
 * the shape `{ bodies: { [templateId]: { [piece]: string } }, subjects, footer }`.
 *
 * IMPORTANT: PL is the single source of truth for the schema. EN/DE must have the SAME keys; parity
 * is enforced by the `email-locale-parity.sh` audit (pre-push), NOT by TypeScript (EN/DE are cast
 * to `typeof PL`).
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
 * DECISION: `typeof emailI18nPl` instead of a hand-written interface makes the PL JSON the source
 * of truth. A new PL key widens the types below; the same key missing in EN/DE is NOT a TS error
 * (the casts suppress it) but a silent runtime fallback to PL, by design (per-locale rollout, no
 * runtime validator on purpose). Drift is caught at the gate, not at startup: the
 * `audit:i18n` (email-parity)` audit fails on any leaf-key or empty-value divergence
 * between the pl/en/de JSON files.
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
  | 'headingInactive'
  | 'headingBan'
  | 'preheader'
  | 'preheaderWithAmount'
  | 'preheaderNoOffer'
  | 'preheaderInactive'
  | 'preheaderBan'
  | 'body'
  | 'bodyWithAmount'
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
  | 'intro'
  | 'introNoName'
  | 'introHide'
  | 'introDelete'
  | 'introWarn'
  | 'introBan'
  | 'adminNoteLabel'
  | 'placeLine'
  | 'noteLine';

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
  return resolveSessionExpiryText(value ?? '');
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
