import type { GetStaticPropsContext } from 'next';
import dynamic from 'next/dynamic';
import { getI18nMessages } from '../../../../application/i18n/i18n.loader';

// LC-14: Lazy-load admin route (client-only, large bundle).
const AdminFeatureFlagsPage = dynamic(
  () =>
    import('../../../../UI/features/admin/AdminFeatureFlagsPage.composition').then(
      m => ({
        default: m.AdminFeatureFlagsPageComposition,
      })
    ),
  { ssr: false }
);

export default function AdminFeatureFlagsShell() {
  return <AdminFeatureFlagsPage />;
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', ['admin']);
  return { props: { messages } };
}
