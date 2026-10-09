import type { GetStaticPropsContext } from 'next';
import dynamic from 'next/dynamic';
import { getI18nMessages } from '../../../../application/i18n/i18n.loader';

// LC-14: Lazy-load admin route (client-only, large bundle).
const AdminSupportPage = dynamic(
  () =>
    import('../../../../UI/features/admin/AdminSupportPage.composition').then(
      m => ({
        default: m.AdminSupportPageComposition,
      })
    ),
  { ssr: false }
);

export default function AdminSupportShell() {
  return <AdminSupportPage />;
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', [
    'admin',
    'buttons',
    'pages.support',
  ]);
  return { props: { messages } };
}
