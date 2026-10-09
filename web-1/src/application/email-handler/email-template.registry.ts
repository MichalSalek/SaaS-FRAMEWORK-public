/**
 * Template generators assembled from the shared layout helpers.
 * Split from email-template.bodies.ts so each file stays under the line cap.
 */

import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { escapeHtml } from './email.utils';
import { EMAIL_BRAND } from './email-brand.const';
import type { BodyPieceKey } from './email-template.i18n';
import {
  renderCtaButton,
  renderHeading,
  renderMuted,
  renderParagraphs,
  renderPreheader,
  renderPs,
} from './email-blocks';
import {
  APP,
  CONTACT,
  GALLERY,
  MESSAGES,
  ONBOARDING,
  PAIRING,
  PRICING,
  PROFILE,
  UPLOAD,
  piece,
  renderStandard,
  routeHref,
  standard,
  text,
  tokenMail,
  type BodyGenerator,
} from './email-template.bodies';

export const BODY_TEMPLATES: Record<string, BodyGenerator> = {
  welcome: standard({
    id: 'welcome',
    medium: 'lifecycle',
    cta: APP,
  }),
  'onboarding-incomplete': standard({
    id: 'onboarding-incomplete',
    medium: 'lifecycle',
    cta: ONBOARDING,
  }),
  'trial-nudge-upload': standard({
    id: 'trial-nudge-upload',
    medium: 'lifecycle',
    cta: UPLOAD,
  }),
  'trial-empty-portfolio': standard({
    id: 'trial-empty-portfolio',
    medium: 'lifecycle',
    cta: UPLOAD,
  }),
  'trial-celebration': standard({
    id: 'trial-celebration',
    medium: 'lifecycle',
    stats: true,
    cta: PAIRING,
  }),
  'trial-progress': standard({
    id: 'trial-progress',
    medium: 'lifecycle',
    stats: true,
    cta: PROFILE,
  }),
  'trial-social-proof': standard({
    id: 'trial-social-proof',
    medium: 'lifecycle',
    cta: UPLOAD,
  }),
  'trial-milestone': standard({
    id: 'trial-milestone',
    medium: 'lifecycle',
    stats: true,
    cta: PROFILE,
    secondary: PAIRING,
  }),
  'trial-fomo': standard({
    id: 'trial-fomo',
    medium: 'lifecycle',
    cta: UPLOAD,
  }),
  'trial-warning': standard({
    id: 'trial-warning',
    medium: 'lifecycle',
    stats: true,
    variants: true,
    offerApplied: false,
    cta: PROFILE,
    ctaInactive: UPLOAD,
    secondary: 'pay',
  }),
  'trial-last-day': standard({
    id: 'trial-last-day',
    medium: 'lifecycle',
    stats: true,
    variants: true,
    offerApplied: true,
    cta: 'pay',
    secondary: GALLERY,
  }),
  'trial-ended': standard({
    id: 'trial-ended',
    medium: 'lifecycle',
    variants: 'zero',
    cta: PRICING,
    secondary: GALLERY,
  }),
  'trial-winback': standard({
    id: 'trial-winback',
    medium: 'lifecycle',
    offer: true,
    cta: 'pay-promo',
  }),
  'cancel-d1': standard({
    id: 'cancel-d1',
    medium: 'transactional',
    cta: 'pay',
  }),
  'cancel-d7-winback': standard({
    id: 'cancel-d7-winback',
    medium: 'lifecycle',
    offer: true,
    cta: 'pay-promo',
  }),
  'cancel-d30-final': standard({
    id: 'cancel-d30-final',
    medium: 'lifecycle',
    cta: PRICING,
  }),
  'upgrade-confirmation': standard({
    id: 'upgrade-confirmation',
    medium: 'transactional',
    cta: PROFILE,
  }),
  'downgrade-notification': standard({
    id: 'downgrade-notification',
    medium: 'transactional',
    cta: 'pay',
  }),
  'payment-failed': standard({
    id: 'payment-failed',
    medium: 'transactional',
    cta: 'pay',
  }),
  'dunning-info': standard({
    id: 'dunning-info',
    medium: 'transactional',
    cta: 'pay',
  }),
  'dunning-urgent': standard({
    id: 'dunning-urgent',
    medium: 'transactional',
    variants: 'zero',
    cta: 'pay',
  }),
  'dunning-final': standard({
    id: 'dunning-final',
    medium: 'transactional',
    variants: 'zero',
    cta: 'pay',
  }),
  'pairing-notification': standard({
    id: 'pairing-notification',
    medium: 'transactional',
    cta: { path: ROUTES_FRONT.PAIRING },
  }),
  'pair-request-notification': standard({
    id: 'pair-request-notification',
    medium: 'transactional',
    cta: PAIRING,
  }),
  'session-shared-notification': (vars, locale) => {
    const sessionId = vars['sessionId'];
    const path = sessionId
      ? ROUTES_FRONT.SESSION_DETAIL.replace(
          '[sessionId]',
          encodeURIComponent(sessionId)
        )
      : ROUTES_FRONT.APP;
    return renderStandard(
      {
        id: 'session-shared-notification',
        medium: 'transactional',
        cta: { path },
      },
      vars,
      locale
    );
  },
  'messaging-notification': standard({
    id: 'messaging-notification',
    medium: 'transactional',
    cta: MESSAGES,
  }),
  // Salon-team invitation to the invitee: the CTA opens her invitations screen,
  // where she accepts or declines (salon-staff-invite-notification.service).
  'salon-staff-invitation': standard({
    id: 'salon-staff-invitation',
    medium: 'transactional',
    cta: { path: ROUTES_FRONT.SALON_INVITATIONS },
  }),
  // DECISION (nie usuwaj tego komentarza):
  // The renewal reminder is a receipt (register B) that a monthly subscriber
  // receives every month: date, card, how to change or cancel, one contact
  // line. No benefits list, no thank-you P.S.: selling a plan to someone who
  // already pays for it read as marketing and repeated itself every cycle.
  'renewal-reminder': (vars, locale) => {
    const id = 'renewal-reminder' as const;
    const supportNote = piece(id, 'supportNote', locale);
    const supportCta = piece(id, 'supportCta', locale);
    const contactHref = routeHref(id, 'transactional', vars, CONTACT);
    return [
      renderPreheader(text(id, 'preheader', locale, vars)),
      renderHeading(text(id, 'heading', locale, vars)),
      renderParagraphs(text(id, 'body', locale, vars)),
      renderCtaButton(
        routeHref(id, 'transactional', vars, {
          path: ROUTES_FRONT.USER_ACCOUNT_PAY,
        }),
        text(id, 'cta', locale, vars)
      ),
      renderMuted(
        `${escapeHtml(supportNote)} <a href="${contactHref}" style="color:${EMAIL_BRAND.primary};">${escapeHtml(supportCta)}</a>`
      ),
    ]
      .filter(part => part.length > 0)
      .join('\n');
  },
  'magic-link': (vars, locale) => {
    const id = 'magic-link' as const;
    const safeUrl = escapeHtml(vars['url'] || '');
    return [
      renderPreheader(text(id, 'preheader', locale, vars)),
      renderHeading(text(id, 'heading', locale, vars)),
      renderParagraphs(text(id, 'body', locale, vars)),
      renderCtaButton(safeUrl, text(id, 'cta', locale, vars)),
      renderMuted(
        `${escapeHtml(piece(id, 'copyLinkLabel', locale))}<br /><a href="${safeUrl}" style="color:${EMAIL_BRAND.primary};word-break:break-all;">${safeUrl}</a>`
      ),
      renderPs(
        text(id, 'ignoreNote', locale, vars) || piece(id, 'ignoreNote', locale)
      ),
    ].join('\n');
  },
  'account-delete-confirm': (vars, locale) =>
    tokenMail('account-delete-confirm', vars, locale, 'confirmUrl', 'danger'),
  'account-deleted-recovery': (vars, locale) =>
    tokenMail('account-deleted-recovery', vars, locale, 'loginUrl', 'primary'),
  'email-change-confirm': (vars, locale) =>
    tokenMail('email-change-confirm', vars, locale, 'confirmUrl', 'primary'),
  'email-change-notify': (vars, locale) => {
    const id = 'email-change-notify' as const;
    return [
      renderPreheader(text(id, 'preheader', locale, vars)),
      renderHeading(text(id, 'heading', locale, vars)),
      renderParagraphs(text(id, 'body', locale, vars)),
    ].join('\n');
  },
  'newsletter-confirm': (vars, locale) =>
    tokenMail('newsletter-confirm', vars, locale, 'confirmUrl', 'primary'),
  'winback-deletion-d60': standard({
    id: 'winback-deletion-d60',
    medium: 'lifecycle',
    offer: true,
    cta: 'login-then-pay',
  }),
  'support-reply-notification': (vars, locale) => {
    const id = 'support-reply-notification' as const;
    const threadId = vars['threadId'] ?? '';
    const path = threadId
      ? ROUTES_FRONT.SUPPORT_THREAD.replace(
          '[threadId]',
          encodeURIComponent(threadId)
        )
      : ROUTES_FRONT.SUPPORT;
    return renderStandard(
      {
        id,
        medium: 'transactional',
        cta: { path },
      },
      vars,
      locale
    );
  },
  'moderation-owner-notification': (vars, locale) => {
    const id = 'moderation-owner-notification' as const;
    const action = vars['moderationAction'] ?? 'HIDE';
    const introKey: BodyPieceKey =
      action === 'DELETE'
        ? 'introDelete'
        : action === 'WARN'
          ? 'introWarn'
          : action === 'BAN'
            ? 'introBan'
            : 'introHide';
    const recordId = vars['galleryRecordId'] ?? '';
    // The button follows the decision: a hidden or noticed photo opens THAT
    // photo, a deleted one opens the gallery, and a banned account gets no
    // button at all (every app route answers 403; the P.S. carries the
    // contact path).
    const photoPath =
      recordId !== ''
        ? ROUTES_FRONT.PHOTO_DETAIL.replace(
            '[id]',
            encodeURIComponent(recordId)
          )
        : null;
    const ctaHref =
      action === 'BAN'
        ? ''
        : action !== 'DELETE' && photoPath !== null
          ? routeHref(id, 'transactional', vars, { path: photoPath })
          : routeHref(id, 'transactional', vars, {
              path: ROUTES_FRONT.GALLERY,
            });
    const ctaLabel =
      action !== 'DELETE' && photoPath !== null
        ? text(id, 'ctaPhoto', locale, vars)
        : text(id, 'cta', locale, vars);
    const intro = text(id, introKey, locale, vars);
    const note = vars['adminNote']?.trim()
      ? `${text(id, 'adminNoteLabel', locale, vars)} ${escapeHtml(vars['adminNote'])}`
      : '';
    // A banned owner reads about the account, not about a photo.
    const preheaderKey: BodyPieceKey =
      action === 'BAN' ? 'preheaderBan' : 'preheader';
    const headingKey: BodyPieceKey =
      action === 'BAN' ? 'headingBan' : 'heading';
    return [
      renderPreheader(text(id, preheaderKey, locale, vars)),
      renderHeading(text(id, headingKey, locale, vars)),
      renderParagraphs(intro),
      note !== '' ? renderParagraphs(note) : '',
      renderCtaButton(ctaHref, ctaLabel),
      renderPs(text(id, 'ps', locale, vars)),
    ]
      .filter(part => part.length > 0)
      .join('\n');
  },
};
