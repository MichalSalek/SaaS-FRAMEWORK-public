import type { GetStaticPropsContext } from 'next';
import dynamic from 'next/dynamic';
import { getI18nMessages } from '../../../../application/i18n/i18n.loader';

// LC-14: Lazy-load admin route (client-only, large bundle).
const AdminPermissionsPage = dynamic(
  () =>
    import('../../../../UI/features/admin/AdminPermissionsPage.composition').then(
      m => ({
        default: m.AdminPermissionsPageComposition,
      })
    ),
  { ssr: false }
);

export default function AdminPermissionsShell() {
  return <AdminPermissionsPage />;
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', ['admin']);
  return { props: { messages } };
}
