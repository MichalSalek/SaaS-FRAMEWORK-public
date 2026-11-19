import { useLocale, useTranslations } from 'next-intl';

export type ErrorBoundaryCopy = {
  title: string;
  action: string;
  home: string;
};

// DECISION: the error fallback carries its own copy of the three `errors.*` strings. The boundary is
// the last screen she sees when something broke, and the commonest break is the messages themselves
// (a poisoned data response left the provider empty and the old fallback printed
// `errors.unexpectedError`). A fallback must never print a key path, so a missing message falls back
// to this table; keep it identical to `errors.*` in the three common.json files.
const FALLBACK_COPY: Readonly<Record<'pl' | 'en' | 'de', ErrorBoundaryCopy>> = {
  pl: {
    title: 'Coś poszło nie tak',
    action: 'Spróbuj ponownie',
    home: 'Wróć na stronę główną',
  },
  en: {
    title: 'Something went wrong',
    action: 'Try again',
    home: 'Back to home',
  },
  de: {
    title: 'Etwas ist schiefgelaufen',
    action: 'Erneut versuchen',
    home: 'Zur Startseite',
  },
};

export const getFallbackErrorBoundaryCopy = (
  locale: string | undefined
): ErrorBoundaryCopy =>
  locale === 'en' || locale === 'de' ? FALLBACK_COPY[locale] : FALLBACK_COPY.pl;

/** Error-boundary copy that never degrades to a raw key path. */
export function useErrorBoundaryCopy(): ErrorBoundaryCopy {
  const t = useTranslations('errors');
  const fallback = getFallbackErrorBoundaryCopy(useLocale());
  return {
    title: t.has('unexpectedError') ? t('unexpectedError') : fallback.title,
    action: t.has('tryAgain') ? t('tryAgain') : fallback.action,
    home: t.has('backToHome') ? t('backToHome') : fallback.home,
  };
}
