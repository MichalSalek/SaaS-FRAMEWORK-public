/**
 * Email Template Bodies — per-template HTML body builders.
 *
 * Text lives in `.shared-kernel/domain/email/locales/`. This module owns
 * structure: preheader, heading, paragraphs, stats, CTA, offer card, P.S.
 *
 * XSS: every `vars` value goes through escapeHtml inside interpolatePiece
 * before it is embedded. Static i18n is author-controlled.
 */

import type { LocaleType } from '@kernel/domain/i18n/i18n.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { ACTIVATION_THRESHOLD } from '@kernel/domain/email/email-schedule.config';
import { escapeHtml } from './email.utils';
import {
  getBodyPiece,
  type BodyPieceKey,
  type BodyTemplateKey,
} from './email-template.i18n';
import {
  renderCtaButton,
  renderHeading,
  renderOfferCard,
  renderParagraphs,
  renderPreheader,
  renderPs,
  renderSecondaryLink,
  renderStats,
} from './email-blocks';
import {
  buildAppHref,
  buildLoginThenPath,
  type EmailUtmMedium,
} from './email-links';
import { expandPluralPlaceholders, renderStatsLine } from './email-stats';

export type BodyGenerator = (
  vars: Record<string, string>,
  locale: LocaleType
) => string;

export const piece = (
  templateKey: BodyTemplateKey,
  pieceKey: BodyPieceKey,
  locale: LocaleType
): string => getBodyPiece(templateKey, pieceKey, locale);

const interpolatePiece = (
  template: string,
  vars: Record<string, string>,
  locale: LocaleType
): string =>
  expandPluralPlaceholders(template, vars, locale).replace(
    /\{\{(\w+)\}\}/g,
    (_, key: string) => {
      const value = vars[key];
      return value !== undefined ? escapeHtml(value) : '';
    }
  );

export const text = (
  id: BodyTemplateKey,
  key: BodyPieceKey,
  locale: LocaleType,
  vars: Record<string, string>
): string => interpolatePiece(piece(id, key, locale), vars, locale);

const galleryCount = (vars: Record<string, string>): number | null => {
  const raw = vars['galleryCount'];
  if (raw == null || raw.trim() === '') {
    return null;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
};

/** Active portfolio = at least the activation threshold. A count of 0 never prints "0 prac". */
const preferInactive = (
  vars: Record<string, string>,
  mode: boolean | 'zero' | undefined
): boolean => {
  if (mode == null || mode === false) {
    return false;
  }
  if (vars['previewVariant'] === 'inactive') {
    return true;
  }
  if (vars['previewVariant'] === 'active') {
    return false;
  }
  const n = galleryCount(vars);
  if (n === null) {
    return false;
  }
  if (mode === 'zero') {
    return n === 0;
  }
  return n < ACTIVATION_THRESHOLD.MIN_GALLERY_RECORDS;
};

type RouteLink = {
  path: string;
  query?: Record<string, string | undefined>;
};

export const routeHref = (
  templateId: string,
  medium: EmailUtmMedium,
  vars: Record<string, string>,
  link: RouteLink
): string =>
  buildAppHref({
    appUrl: vars['appUrl'],
    path: link.path,
    templateId,
    medium,
    ...(link.query ? { query: link.query } : {}),
  });

const payQuery = (
  vars: Record<string, string>,
  withPromo: boolean
): Record<string, string | undefined> => ({
  ...(vars['funnelPlanId']
    ? { planId: vars['funnelPlanId'], billingPeriod: 'month' }
    : {}),
  ...(withPromo && vars['offerCode'] ? { promo: vars['offerCode'] } : {}),
});

const loginThenPayHref = (
  templateId: string,
  medium: EmailUtmMedium,
  vars: Record<string, string>
): string => {
  // Without an issued code the button says "restore the account", so it must
  // land on the sign-in page and nowhere near checkout.
  if (!vars['offerCode']) {
    return routeHref(templateId, medium, vars, { path: ROUTES_FRONT.USER_LOG });
  }
  const payParams = new URLSearchParams();
  if (vars['funnelPlanId']) {
    payParams.set('planId', vars['funnelPlanId']);
    payParams.set('billingPeriod', 'month');
  }
  if (vars['offerCode']) {
    payParams.set('promo', vars['offerCode']);
  }
  payParams.set('utm_source', 'email');
  payParams.set('utm_medium', medium);
  payParams.set('utm_campaign', templateId);
  const payPath = `${ROUTES_FRONT.USER_ACCOUNT_PAY}?${payParams.toString()}`;
  const loginPath = buildLoginThenPath(ROUTES_FRONT.USER_LOG, payPath);
  const raw = vars['appUrl']?.trim() ?? '';
  let origin = '{{appUrl}}';
  if (raw && raw !== '{{appUrl}}') {
    try {
      origin = new URL(raw).origin;
    } catch {
      origin = '{{appUrl}}';
    }
  }
  const loginParams = new URLSearchParams(loginPath.split('?')[1] ?? '');
  loginParams.set('utm_source', 'email');
  loginParams.set('utm_medium', medium);
  loginParams.set('utm_campaign', templateId);
  return `${origin}${ROUTES_FRONT.USER_LOG}?${loginParams.toString()}`;
};

type StandardSpec = {
  id: BodyTemplateKey;
  medium: EmailUtmMedium;
  stats?: boolean;
  /** true = inactive copy below the activation threshold. 'zero' = only when the count is 0. */
  variants?: boolean | 'zero';
  offer?: boolean;
  offerApplied?: boolean;
  cta?: RouteLink | 'pay' | 'pay-promo' | 'login-then-pay';
  ctaInactive?: RouteLink | 'pay' | 'pay-promo';
  secondary?: RouteLink | 'pay';
  tone?: 'primary' | 'danger';
};

const resolveLink = (
  spec: StandardSpec,
  vars: Record<string, string>,
  which: RouteLink | 'pay' | 'pay-promo' | 'login-then-pay'
): string => {
  if (which === 'pay') {
    return routeHref(spec.id, spec.medium, vars, {
      path: ROUTES_FRONT.USER_ACCOUNT_PAY,
    });
  }
  if (which === 'pay-promo') {
    return routeHref(spec.id, spec.medium, vars, {
      path: ROUTES_FRONT.USER_ACCOUNT_PAY,
      query: payQuery(vars, true),
    });
  }
  if (which === 'login-then-pay') {
    return loginThenPayHref(spec.id, spec.medium, vars);
  }
  return routeHref(spec.id, spec.medium, vars, which);
};

export const renderStandard = (
  spec: StandardSpec,
  vars: Record<string, string>,
  locale: LocaleType
): string => {
  const id = spec.id;
  const inactive = preferInactive(vars, spec.variants);
  const hasOffer = spec.offer === true && Boolean(vars['offerCode']);
  const name = vars['displayName']?.trim() ?? '';
  // DECISION (nie usuwaj tego komentarza):
  // German gets the nameless heading on purpose. The renderer addresses DE by
  // the FULL name (Sie with a bare first name is inconsistent), and "Hallo
  // Anna Kowalska" as a vocative is the signature of a system mail, the very
  // thing this copy avoids. The name stays in DE subjects, where it reads fine.
  const headingTpl =
    name !== '' &&
    locale !== 'de' &&
    piece(id, 'headingWithName', locale) !== ''
      ? text(id, 'headingWithName', locale, vars)
      : text(id, 'heading', locale, vars);

  let bodyKey: BodyPieceKey = 'body';
  if (
    hasOffer === false &&
    piece(id, 'bodyNoOffer', locale) !== '' &&
    spec.offer === true
  ) {
    bodyKey = 'bodyNoOffer';
  } else if (inactive && piece(id, 'bodyInactive', locale) !== '') {
    bodyKey = 'bodyInactive';
  } else if (galleryCount(vars) === 0 && piece(id, 'bodyZero', locale) !== '') {
    bodyKey = 'bodyZero';
  }

  const ctaSpec =
    inactive && spec.ctaInactive !== undefined ? spec.ctaInactive : spec.cta;
  const inactiveCta = text(id, 'ctaInactive', locale, vars);
  // An offer mail whose code was never issued (Stripe down, coupon missing)
  // must not promise the discount on the button either: the subject already
  // falls back to `.subjectNoOffer` and the body to `bodyNoOffer`.
  const noOfferCta =
    spec.offer === true && hasOffer === false
      ? text(id, 'ctaNoOffer', locale, vars)
      : '';
  const ctaLabel =
    noOfferCta !== ''
      ? noOfferCta
      : inactive
        ? inactiveCta !== ''
          ? inactiveCta
          : text(id, 'cta', locale, vars)
        : text(id, 'cta', locale, vars);

  const parts = [
    renderPreheader(
      text(
        id,
        spec.offer === true &&
          hasOffer === false &&
          piece(id, 'preheaderNoOffer', locale) !== ''
          ? 'preheaderNoOffer'
          : 'preheader',
        locale,
        vars
      )
    ),
    renderHeading(headingTpl),
    spec.stats === true
      ? renderStats(
          renderStatsLine(
            locale,
            vars['galleryCount'],
            vars['pairedClientsCount']
          )
        )
      : '',
    renderParagraphs(text(id, bodyKey, locale, vars)),
    spec.offerApplied === true && vars['offerApplied'] === '1'
      ? renderParagraphs(text(id, 'offerApplied', locale, vars))
      : '',
    hasOffer === true
      ? renderOfferCard({
          label: text(id, 'offerLabel', locale, vars),
          headline: text(id, 'offerHeadline', locale, vars),
          code: escapeHtml(vars['offerCode'] ?? ''),
          expiry: text(id, 'offerExpiry', locale, vars),
          finePrint: text(id, 'offerFinePrint', locale, vars),
        })
      : '',
    ctaSpec !== undefined && ctaLabel !== ''
      ? renderCtaButton(
          resolveLink(spec, vars, ctaSpec),
          ctaLabel,
          spec.tone ?? 'primary'
        )
      : '',
    spec.secondary !== undefined
      ? renderSecondaryLink(
          resolveLink(
            spec,
            vars,
            spec.secondary === 'pay' ? 'pay' : spec.secondary
          ),
          text(id, 'secondaryCta', locale, vars)
        )
      : '',
    renderPs(text(id, 'ps', locale, vars)),
  ];
  return parts.filter(part => part.length > 0).join('\n');
};

export const UPLOAD: RouteLink = { path: ROUTES_FRONT.GALLERY_UPLOAD_ASSET };
export const PROFILE: RouteLink = { path: ROUTES_FRONT.STYLIST_PROFILE_MANAGE };
export const PAIRING: RouteLink = { path: ROUTES_FRONT.PAIRING };
export const GALLERY: RouteLink = { path: ROUTES_FRONT.GALLERY };
export const PRICING: RouteLink = { path: ROUTES_FRONT.PRICING };
export const APP: RouteLink = { path: ROUTES_FRONT.APP };
export const ONBOARDING: RouteLink = { path: ROUTES_FRONT.ONBOARDING };
export const MESSAGES: RouteLink = { path: ROUTES_FRONT.MESSAGES };
export const CONTACT: RouteLink = { path: ROUTES_FRONT.CONTACT };

export const standard =
  (spec: StandardSpec): BodyGenerator =>
  (vars, locale) =>
    renderStandard(spec, vars, locale);

export const tokenMail = (
  id: BodyTemplateKey,
  vars: Record<string, string>,
  locale: LocaleType,
  urlVar: string,
  tone: 'primary' | 'danger'
): string => {
  const href = escapeHtml(vars[urlVar] || '');
  const ignore = piece(id, 'ignoreNote', locale);
  return [
    renderPreheader(text(id, 'preheader', locale, vars)),
    renderHeading(text(id, 'heading', locale, vars)),
    renderParagraphs(text(id, 'body', locale, vars)),
    renderCtaButton(href, text(id, 'cta', locale, vars), tone),
    ignore ? renderPs(interpolatePiece(ignore, vars, locale)) : '',
  ]
    .filter(part => part.length > 0)
    .join('\n');
};
