import type { LocaleType } from '@kernel/domain/i18n/i18n.config';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { FOOTER_LABELS } from './email-template.content';
import { EMAIL_BRAND as C } from './email-brand.const';
import { getEmailIdentity } from './email-identity';
import { getEmailIllustration } from './email-illustration';
import { escapeHtml } from './email.utils';

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif";

const publicHref = (locale: LocaleType, route: string): string =>
  `${BRAND_CONFIG.url}${locale === 'pl' ? '' : `/${locale}`}${route}`;

/** Shared wrapper, reply destination and quiet secondary paths for every customer mail. */
export const buildEmailLayout = (args: {
  templateId: string;
  bodyContent: string;
  unsubscribeUrl: string;
  locale: LocaleType;
  showAppLink: boolean;
}): string => {
  const { templateId, locale, unsubscribeUrl } = args;
  const f = FOOTER_LABELS[locale];
  const identity = getEmailIdentity();
  // Inbox preview must precede branding and image alt text in the HTML document.
  const preheader =
    args.bodyContent.match(
      /<div\b[^>]*data-email-preheader="1"[^>]*>[\s\S]*?<\/div>/
    )?.[0] ?? '';
  const body = args.bodyContent.replace(preheader, '');
  const participantMail = [
    'messaging-notification',
    'pairing-notification',
    'pair-request-notification',
    'session-shared-notification',
    'salon-staff-invitation',
  ].includes(templateId);
  const signature = identity.senderName;
  const linkStyle = `color:${C.primary};text-decoration:none;font-size:14px;line-height:24px;font-weight:600;`;
  const replyHref = `mailto:${identity.replyTo}`;
  return `<!DOCTYPE html>
<html lang="${locale}" dir="ltr">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>Nailfolio</title>
<style>
@media only screen and (max-width:480px){.email-outer{padding:16px 8px!important}.email-pad{padding-left:24px!important;padding-right:24px!important}.email-art{width:88px!important;height:88px!important}.email-name{font-size:24px!important}.email-logo{width:36px!important;height:36px!important}}
a{text-decoration:none}a:focus-visible{outline:2px solid #c4207e;outline-offset:4px}
@media (prefers-color-scheme:dark){body,.email-ground,.email-card{background-color:#151411!important}.email-ink,h1,.email-card p{color:#ffffff!important}.email-reply{background-color:#151411!important;border-color:#817e7b!important}.email-footer{color:#ffffff!important}.email-link,.email-card a:not(.email-button){color:#ff9ad4!important}.email-button{color:#ffffff!important}.email-offer{background-color:#151411!important}.email-code{background-color:#ffffff!important;color:#151411!important}}

</style>
</head>
<body lang="${locale}" dir="ltr" data-email-template="${escapeHtml(templateId)}" style="margin:0;padding:0;font-family:${FONT};background-color:${C.bgMain};color:${C.ink};">
${preheader}
<table role="presentation" class="email-ground" width="100%" cellpadding="0" cellspacing="0" style="background-color:${C.bgMain};"><tr><td class="email-outer" align="center" style="padding:24px 16px;">
<table role="presentation" class="email-card" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:${C.bgCard};">
<tr><td class="email-pad" style="padding:24px 32px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td valign="middle"><a class="email-link" href="${publicHref(locale, '')}" style="display:inline-block;color:${C.ink};text-decoration:none;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td valign="middle" style="padding-right:10px;"><img class="email-logo" src="${BRAND_CONFIG.url}/logo.png" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border:0;"></td><td class="email-ink email-name" valign="middle" style="font-family:${FONT};font-size:28px;line-height:36px;font-weight:700;letter-spacing:-1px;color:${C.ink};">Nailfolio</td></tr></table></a></td>
<td align="right" valign="middle" width="104"><img class="email-art" src="${BRAND_CONFIG.url}${getEmailIllustration(templateId)}" width="104" height="104" alt="" role="presentation" style="display:block;width:104px;height:104px;border:0;border-radius:12px;"></td>
</tr></table></td></tr>
<tr><td class="email-pad" style="padding:20px 32px 12px;">${body}
<p class="email-ink" style="margin:24px 0 12px;font-size:15px;line-height:24px;font-weight:600;color:${C.ink};">${escapeHtml(signature)}</p>
</td></tr>
<tr><td class="email-pad" style="padding:8px 32px 28px;">
<table role="presentation" class="email-reply" width="100%" cellpadding="0" cellspacing="0" style="background-color:${C.bgCard};border:1px solid ${C.divider};border-radius:12px;"><tr><td style="padding:18px 20px;">
<p class="email-ink" style="margin:0 0 6px;font-size:16px;line-height:26px;font-weight:600;color:${C.ink};">${escapeHtml(f.replyHeading)}</p>
<p style="margin:0 0 8px;font-size:14px;line-height:23px;color:${C.textSecondary};">${escapeHtml(participantMail ? f.participantReplyNote : f.replyBody)}</p>
<a class="email-link" href="${replyHref}" style="${linkStyle}display:inline-block;padding:8px 16px;border:1px solid ${C.primary};border-radius:8px;">${escapeHtml(f.replyCta)}</a>
</td></tr></table>
<p style="margin:18px 0 0;font-size:14px;line-height:26px;">${args.showAppLink ? `<a class="email-link" href="${publicHref(locale, ROUTES_FRONT.APP)}" style="${linkStyle}display:inline-block;padding:8px 0;">${escapeHtml(f.appCta)}</a><br>` : ''}<a class="email-link" href="${publicHref(locale, ROUTES_FRONT.CONTACT)}" style="${linkStyle}display:inline-block;padding:8px 0;">${escapeHtml(f.helpCta)}</a></p>
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;"><tr><td class="email-footer" align="center" style="padding:20px 16px;font-size:14px;line-height:23px;color:${C.textMuted};">
${unsubscribeUrl ? `<p style="margin:0 0 8px;">${escapeHtml(f.unsubscribe)} <a class="email-link" href="${escapeHtml(unsubscribeUrl)}" style="${linkStyle};white-space:nowrap;">${escapeHtml(f.unsubscribeLink)}</a></p>` : ''}
<p style="margin:0;">${escapeHtml(f.companyInfo)}</p>
</td></tr></table>
</td></tr></table></body></html>`;
};
