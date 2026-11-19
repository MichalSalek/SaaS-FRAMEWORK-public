import type { GetStaticPropsContext } from 'next';
import dynamic from 'next/dynamic';
import { getI18nMessages } from '../../../application/i18n/i18n.loader';

// LC-14: Admin pages are large, client-only, and accessed rarely.
// Lazy-load to keep them out of the public initial bundle.
const AdminDashboardPage = dynamic(
  () =>
    import('../../../UI/features/admin/AdminDashboardPage.composition').then(
      m => ({
        default: m.AdminDashboardPageComposition,
      })
    ),
  { ssr: false }
);

export default function AdminDashboardShell() {
  return <AdminDashboardPage />;
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', [
    'admin',
    'dashboard',
  ]);
  return { props: { messages } };
}
