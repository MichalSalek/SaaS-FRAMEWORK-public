import { useEffect } from 'react';
import { useRouter } from 'next/router';
import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../../application/i18n/i18n.loader';
import { buildAccountSectionHref } from '../../../application/policies/account-sections.config';

// This route has no view of its own: the activity timeline lives as an account section
// (AccountActivityPanel, /app/user/account/activity). It stays as a permanent redirect so old
// links/bookmarks are not dead ends; router.replace (not push) leaves no history entry.
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
