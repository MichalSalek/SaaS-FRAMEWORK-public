import type { GetServerSidePropsContext } from 'next';
import { getI18nMessages } from '../../../application/i18n/i18n.loader';
import { ClientCardPageComposition } from '../../../UI/features/client-card/ClientCardPage.composition';

interface Props {
  clientUserId: string;
}

export default function ClientCardShell({ clientUserId }: Props) {
  return <ClientCardPageComposition clientUserId={clientUserId} />;
}

export async function getServerSideProps({
  locale,
  params,
}: GetServerSidePropsContext) {
  const clientUserId = params?.id as string | undefined;

  if (!clientUserId) {
    return { notFound: true as const };
  }

  const messages = await getI18nMessages(locale || 'pl', ['clientCard']);
  return { props: { messages, clientUserId } };
}
