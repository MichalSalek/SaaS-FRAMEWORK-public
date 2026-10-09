import type { GetStaticPropsContext } from 'next';
import dynamic from 'next/dynamic';
import { getI18nMessages } from '../../../../application/i18n/i18n.loader';

// Lazy-load admin route (client-only, large bundle).
const AdminEmailPreviewPage = dynamic(
  () =>
    import('../../../../UI/features/admin/AdminEmailPreviewPage.composition').then(
      m => ({
        default: m.AdminEmailPreviewPageComposition,
      })
    ),
  { ssr: false }
);

export default function AdminEmailPreviewShell() {
  return <AdminEmailPreviewPage />;
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', ['admin', 'email']);
  return { props: { messages } };
}
