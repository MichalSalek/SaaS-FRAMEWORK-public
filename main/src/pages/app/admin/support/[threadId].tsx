import type { GetStaticPropsContext, GetStaticPathsResult } from 'next';
import dynamic from 'next/dynamic';
import { getI18nMessages } from '../../../../application/i18n/i18n.loader';

// LC-14: Lazy-load admin route (client-only, large bundle).
const AdminSupportThreadPage = dynamic(
  () =>
    import('../../../../UI/features/admin/AdminSupportThreadPage.composition').then(
      m => ({
        default: m.AdminSupportThreadPageComposition,
      })
    ),
  { ssr: false }
);

export default function AdminSupportThreadShell() {
  return <AdminSupportThreadPage />;
}

export async function getStaticPaths(): Promise<GetStaticPathsResult> {
  return { paths: [], fallback: 'blocking' };
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', [
    'admin',
    'pages.support',
  ]);
  return { props: { messages } };
}
