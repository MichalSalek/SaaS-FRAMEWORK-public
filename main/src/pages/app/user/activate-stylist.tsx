import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../../application/i18n/i18n.loader';
import { ActivateRolePageComposition } from '../../../UI/features/account/ActivateRolePage.composition';

export default function ActivateStylistShell() {
  return <ActivateRolePageComposition roleValue='stylist' />;
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale ?? 'pl', ['account']);
  return { props: { messages } };
}
