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
import { expandPluralPlaceholders } from './email-stats';
import { escapeHtml } from './email.utils';
import {
  SUBJECTS,
  FOOTER_LABELS,
  BODY_TEMPLATES,
} from './email-template.content';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { EMAIL_BRAND } from './email-brand.const';

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

const buildBaseHtml = (
  bodyContent: string,
  unsubscribeUrl: string,
  locale: LocaleType
): string => {
  const footer = FOOTER_LABELS[locale];

  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nailfolio</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:${EMAIL_BRAND.bgMain};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${EMAIL_BRAND.bgMain};">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:${EMAIL_BRAND.bgCard};border-radius:12px;border:1px solid ${EMAIL_BRAND.divider};">
          <!-- Header -->
          <tr>
            <td style="padding:24px 40px;text-align:center;">
              <span style="font-size:20px;font-weight:700;color:${EMAIL_BRAND.primary};">Nailfolio</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px 40px;">
              ${bodyContent}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;text-align:center;">
              ${
                unsubscribeUrl
                  ? `<p style="font-size:14px;line-height:21px;color:${EMAIL_BRAND.textMuted};margin:0 0 8px;">
                ${escapeHtml(footer.unsubscribe)}
                <a href="${escapeHtml(unsubscribeUrl)}" style="color:${EMAIL_BRAND.primary};text-decoration:underline;">${escapeHtml(footer.unsubscribeLink)}</a>
              </p>`
                  : ''
              }
              <p style="font-size:14px;line-height:21px;color:${EMAIL_BRAND.textMuted};margin:0;">
                ${escapeHtml(footer.companyInfo)}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

// ────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────

// Rzeczownik zastępczy dla klientki bez ustawionej nazwy (User.name domyślnie ''
// przy signupie magic-link/QR). Puste {{clientName}} na POCZĄTKU zdania dałoby
// zepsuty subject/body ze spacją wiodącą i osieroconym czasownikiem („ udostępniła
// Ci sesję…"). Locale żyje TU (renderer), nie w listenerze, więc podstawiamy
// poprawny językowo rzeczownik. Dotyczy maili z clientName sentence-initial
// (session-shared-notification, pair-request-notification).
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
  // Normalizacja PRZED renderem subject+body: puste clientName → rzeczownik
  // zastępczy w języku odbiorcy (patrz CLIENT_NAME_FALLBACK). Nie dotyka innych
  // vars ani szablonów, które clientName nie używają (klucz musi już istnieć).
  const withClientName =
    'clientName' in vars && !vars.clientName?.trim()
      ? {
          ...vars,
          clientName: CLIENT_NAME_FALLBACK[locale] ?? CLIENT_NAME_FALLBACK.pl,
        }
      : vars;
  // Zwrot do odbiorcy ({{addressName}}): PL i EN imieniem („Anna, jutro…"),
  // nie pełną nazwą (brzmiało jak automat); DE pełną nazwą, bo forma Sie z
  // samym imieniem jest niespójna. Jeden placeholder we wszystkich językach
  // trzyma parytet interpolacji (audit:i18n-interpolation).
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
  const html = buildBaseHtml(interpolatedBody, unsubscribeUrl, locale);

  // 4. Generate text fallback
  const text = stripHtml(html);

  return { subject, html, text };
};

// ────────────────────────────────────────────
// Startup validation — catch template/subject key mismatches at boot
// ────────────────────────────────────────────

(() => {
  const errors: string[] = [];

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
    // DECISION (nie usuwaj tego komentarza):
    // Subject key is derived from triggerDay (email.cancel.d${N}.subject) because the
    // cancel SUBJECT scheme uses the bare day number, whereas the BODY key is stored
    // explicitly on the rule (bodyTemplateId) — body keys carry semantic suffixes
    // (cancel-d7-winback / cancel-d30-final) that do NOT match the day-based subject
    // scheme. Do not unify these into one derivation.
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
