/**
 * Newsletter landing pages — shared, self-contained HTML for the GET
 * email-link endpoints (confirm + unsubscribe). Both endpoints must serve
 * text/html (never raw JSON) to a user who clicked a link in their email.
 *
 * i18n: tiny 3-language dictionary (pl/en/de, fallback = kernel default
 * locale via getLocaleOrDefault at the call sites). The target locale is
 * carried as a `?locale=` query param appended when the link is generated
 * (confirm: newsletter-subscribe operation; unsubscribe: broadcast helpers).
 * Deliberately NOT a frontend route — these pages must work standalone.
 */

import { EMAIL_BRAND } from '@app/email-handler/email-brand.const';
import type { LocaleType } from '@kernel/domain/i18n/i18n.config';

export type NewsletterLandingVariant =
  | 'CONFIRM_SUCCESS'
  | 'CONFIRM_ALREADY'
  | 'CONFIRM_ERROR'
  | 'UNSUBSCRIBE_SUCCESS'
  | 'UNSUBSCRIBE_ALREADY'
  | 'UNSUBSCRIBE_ERROR';

type LandingCopy = {
  heading: string;
  body: string;
};

const LANDING_COPY: Record<
  NewsletterLandingVariant,
  Record<LocaleType, LandingCopy>
> = {
  CONFIRM_SUCCESS: {
    pl: {
      heading: 'Zapis na newsletter potwierdzony',
      body: 'Twój zapis na newsletter Nailfolio został potwierdzony.',
    },
    en: {
      heading: 'Newsletter signup confirmed',
      body: 'Your Nailfolio newsletter signup has been confirmed.',
    },
    de: {
      heading: 'Newsletter-Anmeldung bestätigt',
      body: 'Ihre Anmeldung zum Nailfolio-Newsletter wurde bestätigt.',
    },
  },
  CONFIRM_ALREADY: {
    pl: {
      heading: 'Zapis na newsletter jest już potwierdzony',
      body: 'Twój adres jest już zapisany na newsletter Nailfolio. Nie musisz ponownie potwierdzać zapisu.',
    },
    en: {
      heading: 'Newsletter signup already confirmed',
      body: 'Your address is already subscribed to the Nailfolio newsletter. No further confirmation is needed.',
    },
    de: {
      heading: 'Newsletter-Anmeldung bereits bestätigt',
      body: 'Ihre Adresse ist bereits für den Nailfolio-Newsletter angemeldet. Eine erneute Bestätigung ist nicht erforderlich.',
    },
  },
  CONFIRM_ERROR: {
    pl: {
      heading: 'Link jest nieprawidłowy lub wygasł',
      body: 'Otwórz pełny link z wiadomości e-mail lub zapisz się ponownie na newsletter.',
    },
    en: {
      heading: 'This link is invalid or has expired',
      body: 'Open the complete link from the email or subscribe to the newsletter again.',
    },
    de: {
      heading: 'Der Link ist ungültig oder abgelaufen',
      body: 'Öffnen Sie den vollständigen Link aus der E-Mail oder melden Sie sich erneut zum Newsletter an.',
    },
  },
  UNSUBSCRIBE_SUCCESS: {
    pl: {
      heading: 'Zapis na newsletter zakończony',
      body: 'Twój adres został usunięty z listy newslettera Nailfolio. Możesz zapisać się ponownie w dowolnym momencie.',
    },
    en: {
      heading: 'Newsletter subscription ended',
      body: 'Your address has been removed from the Nailfolio newsletter list. You can subscribe again at any time.',
    },
    de: {
      heading: 'Newsletter-Abmeldung abgeschlossen',
      body: 'Ihre Adresse wurde von der Nailfolio-Newsletter-Liste entfernt. Sie können sich jederzeit erneut anmelden.',
    },
  },
  UNSUBSCRIBE_ALREADY: {
    pl: {
      heading: 'Adres jest już wypisany z newslettera',
      body: 'Twój adres został wcześniej usunięty z listy newslettera Nailfolio.',
    },
    en: {
      heading: 'Already unsubscribed from the newsletter',
      body: 'Your address was previously removed from the Nailfolio newsletter list.',
    },
    de: {
      heading: 'Bereits vom Newsletter abgemeldet',
      body: 'Ihre Adresse wurde bereits von der Nailfolio-Newsletter-Liste entfernt.',
    },
  },
  UNSUBSCRIBE_ERROR: {
    pl: {
      heading: 'Link jest nieprawidłowy lub wygasł',
      body: 'Otwórz pełny link z wiadomości e-mail. Możesz też wypisać się z newslettera w ustawieniach konta.',
    },
    en: {
      heading: 'This link is invalid or has expired',
      body: 'Open the complete link from the email. You can also unsubscribe in your account settings.',
    },
    de: {
      heading: 'Der Link ist ungültig oder abgelaufen',
      body: 'Öffnen Sie den vollständigen Link aus der E-Mail. Sie können sich auch in Ihren Kontoeinstellungen abmelden.',
    },
  },
};

/**
 * Render the minimal, self-contained landing page (markup/styles identical
 * to the previous per-endpoint inline templates; only `lang` + copy vary).
 */
export const renderNewsletterLandingHtml = (
  variant: NewsletterLandingVariant,
  locale: LocaleType
): string => {
  const { heading, body } = LANDING_COPY[variant][locale];
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nailfolio: ${heading}</title>
  <style>
    body { margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif; background:${EMAIL_BRAND.bgMain}; color:${EMAIL_BRAND.ink}; }
    .container { max-width:520px; margin:80px auto; padding:32px 40px; background:${EMAIL_BRAND.bgCard}; border-radius:12px; border:1px solid ${EMAIL_BRAND.divider}; text-align:center; }
    h1 { font-size:22px; margin:0 0 16px; color:${EMAIL_BRAND.ink}; }
    p { font-size:16px; line-height:24px; color:${EMAIL_BRAND.textSecondary}; margin:0; }
    .brand { color:${EMAIL_BRAND.primary}; font-weight:700; }
  </style>
</head>
<body>
  <main class="container">
    <p class="brand" style="margin:0 0 16px;">Nailfolio</p>
    <h1>${heading}</h1>
    <p>${body}</p>
  </main>
</body>
</html>`;
};
