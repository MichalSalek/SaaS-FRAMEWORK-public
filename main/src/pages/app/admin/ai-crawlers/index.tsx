import type { GetStaticPropsContext } from 'next';
import dynamic from 'next/dynamic';
import { getI18nMessages } from '../../../../application/i18n/i18n.loader';

// LC-14: Lazy-load admin route (client-only, large bundle).
const AdminAiCrawlersPage = dynamic(
  () =>
    import('../../../../UI/features/admin/AdminAiCrawlersPage').then(m => ({
      default: m.AdminAiCrawlersPageComposition,
    })),
  { ssr: false }
);

export default function AdminAiCrawlersShell() {
  return <AdminAiCrawlersPage />;
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', ['admin']);
  return { props: { messages } };
}
