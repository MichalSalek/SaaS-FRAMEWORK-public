/**
 * Email-safe building blocks. Table layout, inline styles, brand hex only.
 * No gradients, no shadows, no single-sided borders. A full 1px border or a
 * flat tinted background is the frame. Rounded corners follow the product
 * (pill buttons, 12px cards).
 *
 * Callers pass already-escaped text. This module does not escape.
 */

import { EMAIL_BRAND } from './email-brand.const';

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

/** Hidden inbox preview line. Padding stops clients from pulling the body in. */
export const renderPreheader = (text: string): string => {
  if (!text) {
    return '';
  }
  const pad = '&nbsp;&zwnj;'.repeat(8);
  return `<div data-email-preheader="1" style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${EMAIL_BRAND.bgCard};">${text}${pad}</div>`;
};

export const renderHeading = (text: string): string =>
  text
    ? `<h1 style="font-family:${FONT};font-size:22px;line-height:30px;font-weight:600;color:${EMAIL_BRAND.ink};margin:0 0 16px;">${text}</h1>`
    : '';

/** Body copy may contain `\n\n` paragraph breaks. Single newlines stay in-flow. */
export const renderParagraphs = (text: string): string => {
  if (!text.trim()) {
    return '';
  }
  return text
    .split(/\n\n+/)
    .map(part => part.trim())
    .filter(part => part.length > 0)
    .map(
      part =>
        `<p style="font-family:${FONT};font-size:16px;line-height:26px;color:${EMAIL_BRAND.textSecondary};margin:0 0 16px;">${part.replace(/\n/g, '<br />')}</p>`
    )
    .join('\n');
};

export const renderStats = (text: string): string =>
  text
    ? `<p style="font-family:${FONT};font-size:15px;line-height:24px;font-weight:600;color:${EMAIL_BRAND.ink};margin:0 0 16px;">${text}</p>`
    : '';

/**
 * Full-width on narrow clients via a 100% table. Min height ~48px from
 * vertical padding. Pill radius matches the product control.
 */
export const renderCtaButton = (
  href: string,
  label: string,
  tone: 'primary' | 'danger' = 'primary'
): string => {
  if (!href || !label) {
    return '';
  }
  const bg = tone === 'danger' ? '#b42318' : EMAIL_BRAND.primary;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;"><tr><td align="center" bgcolor="${bg}" style="border-radius:999px;background-color:${bg};"><a href="${href}" style="display:block;padding:14px 24px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:${EMAIL_BRAND.primaryContrast};text-decoration:none;text-align:center;border-radius:999px;">${label}</a></td></tr></table>`;
};

export const renderSecondaryLink = (href: string, label: string): string => {
  if (!href || !label) {
    return '';
  }
  return `<p style="font-family:${FONT};font-size:15px;line-height:24px;margin:0 0 16px;text-align:center;"><a href="${href}" style="color:${EMAIL_BRAND.primary};text-decoration:underline;">${label}</a></p>`;
};

export type OfferCardInput = {
  label: string;
  headline: string;
  code: string;
  expiry: string;
  finePrint: string;
};

export const renderOfferCard = (offer: OfferCardInput): string => {
  if (!offer.code) {
    return '';
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background-color:${EMAIL_BRAND.bgMain};border:1px solid ${EMAIL_BRAND.divider};border-radius:12px;"><tr><td style="padding:20px 24px;font-family:${FONT};">
<p style="margin:0 0 8px;font-size:14px;line-height:22px;color:${EMAIL_BRAND.textMuted};">${offer.label}</p>
<p style="margin:0 0 12px;font-size:20px;line-height:28px;font-weight:600;color:${EMAIL_BRAND.ink};">${offer.headline}</p>
<p style="margin:0 0 12px;"><span style="display:inline-block;padding:8px 16px;border:1px solid ${EMAIL_BRAND.divider};border-radius:999px;background-color:${EMAIL_BRAND.bgCard};font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:18px;line-height:24px;letter-spacing:1px;color:${EMAIL_BRAND.ink};">${offer.code}</span></p>
<p style="margin:0 0 8px;font-size:14px;line-height:22px;color:${EMAIL_BRAND.textSecondary};">${offer.expiry}</p>
<p style="margin:0;font-size:14px;line-height:21px;color:${EMAIL_BRAND.textMuted};">${offer.finePrint}</p>
</td></tr></table>`;
};

export const renderPs = (text: string): string =>
  text
    ? `<p style="font-family:${FONT};font-size:14px;line-height:22px;color:${EMAIL_BRAND.textMuted};margin:8px 0 0;">${text}</p>`
    : '';

export const renderMuted = (html: string): string =>
  html
    ? `<p style="font-family:${FONT};font-size:14px;line-height:21px;color:${EMAIL_BRAND.textMuted};margin:0 0 16px;">${html}</p>`
    : '';
