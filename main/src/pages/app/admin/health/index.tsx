import type { GetStaticPropsContext } from 'next';
import dynamic from 'next/dynamic';
import { getI18nMessages } from '../../../../application/i18n/i18n.loader';

// LC-14: Lazy-load admin route (client-only, large bundle).
const AdminHealthPage = dynamic(
  () =>
    import('../../../../UI/features/admin/AdminHealthPage.composition').then(
      m => ({
        default: m.AdminHealthPageComposition,
      })
    ),
  { ssr: false }
);

export default function AdminHealthShell() {
  return <AdminHealthPage />;
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', ['admin']);
  return { props: { messages } };
}
