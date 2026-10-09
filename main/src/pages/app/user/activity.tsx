import { useEffect } from 'react';
import { useRouter } from 'next/router';
import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../../application/i18n/i18n.loader';
import { buildAccountSectionHref } from '../../../application/policies/account-sections.config';

// DECISION (nie usuwaj tego komentarza):
// /app/user/activity nie ma już własnego widoku — bogaty timeline aktywności
// żyje jako sekcja konta (AccountActivityPanel, trasa
// /app/user/account/activity). Ten route ZOSTAJE jako trwały redirect, żeby
// stare linki/zakładki nie były martwym dead-endem. router.replace (nie push)
// — brak wpisu w historii.
export default function ActivityRedirectShell() {
  const router = useRouter();
  useEffect(() => {
    void router.replace(buildAccountSectionHref('activity'));
  }, [router]);
  return null;
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', ['account']);
  return { props: { messages } };
}
