import type {
  GetStaticPathsResult,
  GetStaticPropsContext,
  GetStaticPropsResult,
} from 'next';
import { I18N_CONFIG } from '@kernel/domain/i18n/i18n.config';
import { getI18nMessages } from '../../../../application/i18n/i18n.loader';
import {
  ACCOUNT_SECTION_IDS,
  resolveAccountSection,
  type AccountSectionId,
} from '../../../../application/policies/account-sections.config';
import { AccountSectionPageComposition } from '../../../../UI/features/account/AccountSectionPage.composition';

interface AccountSectionShellProps {
  section: AccountSectionId;
}

export default function AccountSectionShell({
  section,
}: AccountSectionShellProps) {
  return <AccountSectionPageComposition section={section} />;
}

// The seven sections are the whole universe of this route: anything else is a
// 404 (`fallback: false`). The static sibling `account/pay` keeps winning over
// this dynamic segment (Next resolves predefined routes first).
export function getStaticPaths(): GetStaticPathsResult {
  return {
    paths: I18N_CONFIG.locales.flatMap(locale =>
      ACCOUNT_SECTION_IDS.map(section => ({ params: { section }, locale }))
    ),
    fallback: false,
  };
}

export async function getStaticProps({
  locale,
  params,
}: GetStaticPropsContext): Promise<
  GetStaticPropsResult<AccountSectionShellProps & { messages: unknown }>
> {
  const section = resolveAccountSection(params?.['section']);
  if (section === null) {
    return { notFound: true };
  }
  const messages = await getI18nMessages(locale || 'pl', [
    'account',
    'validation',
  ]);
  return { props: { messages, section } };
}
