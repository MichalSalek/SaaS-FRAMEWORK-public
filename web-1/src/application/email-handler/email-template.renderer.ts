/**
 * Email Template Renderer
 *
 * SRP: Render lifecycle emails to HTML + text with i18n subject lines.
 * Email-safe HTML: table-based, inline styles, max 600px.
 *
 * Content data (subjects, footers, body templates) lives in
 * email-template.content.ts — this file contains only rendering logic.
 */

import type { LocaleType } from '@kernel/domain/i18n/i18n.config';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import {
  TRIAL_EMAIL_SCHEDULE,
  CANCEL_EMAIL_SCHEDULE,
  DUNNING_EMAIL_SCHEDULE,
  ONBOARDING_ABANDONMENT_RULE,
  RENEWAL_REMINDER_RULE,
} from '@kernel/domain/email/email-schedule.config';
import { FREE_EMAIL_RULES } from '@kernel/domain/email/email-free.config';
import { expandPluralPlaceholders } from './email-stats';
import { escapeHtml } from './email.utils';
import { SUBJECTS, BODY_TEMPLATES } from './email-template.content';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { EMAIL_BRAND } from './email-brand.const';
import { buildEmailLayout } from './email-layout';
import { trackLifecycleEmailLinks } from './email-lifecycle-links';
export { EMAIL_LIFECYCLE_CTA_IDS } from './email-lifecycle-links';

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

// ────────────────────────────────────────────
// Interpolation
// ────────────────────────────────────────────

/**
 * Interpolate {{var}} placeholders in a plain-text string (no HTML escaping).
 * Use for RFC2822 subject lines and plain-text body parts — values are inserted
 * verbatim so "Ania & Kasia" stays "Ania & Kasia", not "Ania &amp; Kasia".
 * HTML body content uses escapeHtml() directly (see email-template.bodies.ts interpolatePiece).
 */
const interpolatePlainText = (
  template: string,
  vars: Record<string, string>,
  locale: LocaleType
): string => {
  return expandPluralPlaceholders(template, vars, locale).replace(
    /\{\{(\w+)\}\}/g,
    (_, key: string) => {
      const value = vars[key];
      return value !== undefined ? value : '';
    }
  );
};

// ────────────────────────────────────────────
// HTML strip for text fallback
// ────────────────────────────────────────────

/**
 * Strip HTML tags and decode entities for plain text fallback.
 */
const decodeEntities = (value: string): string =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

export const getEmailPreheader = (html: string): string =>
  decodeEntities(
    html
      .match(/data-email-preheader="1"[^>]*>([\s\S]*?)<\/div>/)?.[1]
      ?.replace(/&nbsp;|&zwnj;/g, '') ?? ''
  );

const stripHtml = (html: string): string => {
  const withoutPreheader = html.replace(
    /<div\b[^>]*data-email-preheader="1"[^>]*>[\s\S]*?<\/div>/gi,
    ''
  );
  // Keep the href when the visible label is not the URL itself, so the
  // text/plain part still contains a working CTA after tags are stripped.
  const withHrefs = withoutPreheader.replace(
    /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_match, href: string, label: string) => {
      const visible = decodeEntities(label.replace(/<[^>]+>/g, '').trim());
      const url = decodeEntities(href);
      if (!url || visible.includes(url)) {
        return visible;
      }
      return `${visible}\n${url}`;
    }
  );
  return (
    withHrefs
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/tr>/gi, '\n')
      .replace(/<\/td>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&zwnj;/g, '')
      // Table cells leave a space before every line break. Trailing whitespace
      // is noise in text/plain and quoted-printable encodes it as `=20` right
      // after a URL, where naive link extraction glues it onto the link.
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
};

// ────────────────────────────────────────────
// Base HTML template (email-safe, table-based)
// ────────────────────────────────────────────

// ────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────

// Fallback noun for a client without a name (User.name defaults to '' on magic-link/QR signup).
// An empty {{clientName}} at the START of a sentence would give a broken subject/body with a
// leading space and an orphaned verb („ udostępniła Ci sesję…"). The locale lives HERE (renderer),
// not in the listener, so the grammatically correct noun is substituted. Applies to mails with a
// sentence-initial clientName (session-shared-notification, pair-request-notification).
const CLIENT_NAME_FALLBACK: Record<LocaleType, string> = {
  pl: 'Klientka',
  en: 'A client',
  de: 'Eine Kundin',
};

/**
 * Render a complete lifecycle email (subject + html + text).
 *
 * @param templateId - Body template identifier (e.g., 'welcome', 'trial-nudge-upload')
 * @param vars - Personalization variables to interpolate
 * @param locale - Target locale
 * @param unsubscribeUrl - Full unsubscribe URL for footer
 * @param subjectKey - i18n key for the subject line
 * @returns Rendered email with subject, html, and text
 */
export const renderEmailTemplate = (
  templateId: string,
  vars: Record<string, string>,
  locale: LocaleType,
  unsubscribeUrl: string,
  subjectKey?: string
): RenderedEmail => {
  // Normalise BEFORE rendering subject+body: an empty clientName becomes the fallback noun in the
  // recipient's language (see CLIENT_NAME_FALLBACK). Touches no other vars and no template that
  // does not use clientName (the key must already exist).
  const withClientName =
    'clientName' in vars && !vars.clientName?.trim()
      ? {
          ...vars,
          clientName: CLIENT_NAME_FALLBACK[locale] ?? CLIENT_NAME_FALLBACK.pl,
        }
      : vars;
  // Salutation ({{addressName}}): PL and EN use the first name („Anna, jutro…”), not the full name
  // (read like a bot); DE uses the full name because Sie with a first name alone is inconsistent.
  // One placeholder in all languages keeps interpolation parity (`audit:i18n` (interpolation)).
  const displayName = (withClientName.displayName ?? '').trim();
  const firstName = displayName.split(/\s+/)[0] ?? '';
  const effectiveVars =
    withClientName.addressName !== undefined
      ? withClientName
      : {
          ...withClientName,
          addressName: locale === 'de' ? displayName : firstName,
        };

  // 1. Resolve subject. An offer subject („20% taniej") has a `.subjectNoOffer`
  // sibling: when no code was issued (Stripe down, coupon missing) the body
  // already falls back to bodyNoOffer, and the subject must not promise a
  // discount the body does not carry.
  const noOfferKey = subjectKey?.replace(/\.subject$/, '.subjectNoOffer');
  const resolvedSubjectKey =
    noOfferKey !== undefined &&
    !effectiveVars['offerCode'] &&
    SUBJECTS[noOfferKey] != null
      ? noOfferKey
      : subjectKey;
  const subjectTemplate =
    resolvedSubjectKey != null && SUBJECTS[resolvedSubjectKey] != null
      ? SUBJECTS[resolvedSubjectKey][locale] || SUBJECTS[resolvedSubjectKey].pl
      : '';
  // Subjects open with "{{addressName}}, …". An account without any name would
  // start with a bare comma, so drop it and capitalise what remains.
  const subject = interpolatePlainText(
    subjectTemplate,
    effectiveVars,
    locale
  ).replace(/^\s*,\s*(.)/u, (_, first: string) =>
    first.toLocaleUpperCase(locale)
  );

  // 2. Render body
  const bodyGenerator = BODY_TEMPLATES[templateId];
  const bodyContent =
    bodyGenerator != null
      ? bodyGenerator(effectiveVars, locale)
      : `<p style="font-size:16px;line-height:24px;color:${EMAIL_BRAND.textSecondary};">Nailfolio</p>`;

  // Interpolate appUrl placeholder in body
  const interpolatedBody = bodyContent.replace(
    /\{\{appUrl\}\}/g,
    escapeHtml(effectiveVars['appUrl'] || BRAND_CONFIG.url)
  );

  // 3. Build full HTML
  const layoutHtml = buildEmailLayout({
    templateId,
    bodyContent: interpolatedBody,
    unsubscribeUrl,
    locale,
    showAppLink:
      !(
        templateId === 'moderation-owner-notification' &&
        effectiveVars['moderationAction'] === 'BAN'
      ) && templateId !== 'account-delete-confirm',
  });

  const html = effectiveVars['lifecycleMessageId']
    ? trackLifecycleEmailLinks(layoutHtml, effectiveVars['lifecycleMessageId'])
    : layoutHtml;

  // 4. Generate text fallback
  const text = stripHtml(html);

  return { subject, html, text };
};

// ────────────────────────────────────────────
// Startup validation — catch template/subject key mismatches at boot
// ────────────────────────────────────────────

(() => {
  const errors: string[] = [];

  for (const [templateId, rule] of Object.entries(FREE_EMAIL_RULES)) {
    if (
      BODY_TEMPLATES[templateId] == null ||
      SUBJECTS[rule.subjectKey] == null
    ) {
      errors.push(`Missing Free onboarding template or subject: ${templateId}`);
    }
  }

  for (const rule of TRIAL_EMAIL_SCHEDULE) {
    if (BODY_TEMPLATES[rule.bodyTemplateId] == null) {
      errors.push(
        `Missing BODY_TEMPLATE for schedule rule "${rule.id}": "${rule.bodyTemplateId}"`
      );
    }
    if (rule.subjectKey != null && SUBJECTS[rule.subjectKey] == null) {
      errors.push(
        `Missing SUBJECT for schedule rule "${rule.id}": "${rule.subjectKey}"`
      );
    }
  }

  for (const rule of CANCEL_EMAIL_SCHEDULE) {
    if (BODY_TEMPLATES[rule.bodyTemplateId] == null) {
      errors.push(
        `Missing BODY_TEMPLATE for cancel rule "${rule.id}": "${rule.bodyTemplateId}"`
      );
    }
    // DECISION: the cancel SUBJECT key is derived from triggerDay (email.cancel.d${N}.subject),
    // whereas the BODY key is stored explicitly on the rule (bodyTemplateId): body keys carry
    // semantic suffixes (cancel-d7-winback / cancel-d30-final) that do not match the day-based
    // subject scheme. Do not unify them into one derivation.
    const subjectKey = `email.cancel.d${rule.triggerDay}.subject`;
    if (SUBJECTS[subjectKey] == null) {
      errors.push(
        `Missing SUBJECT for cancel rule "${rule.id}": "${subjectKey}"`
      );
    }
  }

  for (const rule of DUNNING_EMAIL_SCHEDULE) {
    if (BODY_TEMPLATES[rule.bodyTemplateId] == null) {
      errors.push(
        `Missing BODY_TEMPLATE for dunning rule "${rule.id}": "${rule.bodyTemplateId}"`
      );
    }
    if (rule.subjectKey != null && SUBJECTS[rule.subjectKey] == null) {
      errors.push(
        `Missing SUBJECT for dunning rule "${rule.id}": "${rule.subjectKey}"`
      );
    }
  }

  // Validate standalone rules (onboarding abandonment + renewal reminder)
  for (const rule of [ONBOARDING_ABANDONMENT_RULE, RENEWAL_REMINDER_RULE]) {
    if (BODY_TEMPLATES[rule.bodyTemplateId] == null) {
      errors.push(
        `Missing BODY_TEMPLATE for lifecycle rule "${rule.id}": "${rule.bodyTemplateId}"`
      );
    }
    if (SUBJECTS[rule.subjectKey] == null) {
      errors.push(
        `Missing SUBJECT for lifecycle rule "${rule.id}": "${rule.subjectKey}"`
      );
    }
  }

  // Validate ad-hoc magic-link template. It is the SOLE login path and is NOT part of
  // any schedule rule (triggered on demand by Better Auth), so it would otherwise escape
  // the loops above. A missing body/subject here means users cannot log in.
  if (BODY_TEMPLATES['magic-link'] == null) {
    errors.push('Missing BODY_TEMPLATE for magic-link: "magic-link"');
  }
  if (SUBJECTS['email.magicLink.subject'] == null) {
    errors.push('Missing SUBJECT for magic-link: "email.magicLink.subject"');
  }

  if (errors.length > 0) {
    reportIssueBackend({
      namespace: 'EMAIL_TEMPLATE_VALIDATION',
      message: `Template/subject key mismatch in email schedule config: ${errors.join('; ')}`,
      payload: { errors },
      mode: 'error',
    });
  }
})();
