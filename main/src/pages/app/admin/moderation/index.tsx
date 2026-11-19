import type { GetStaticPropsContext } from 'next';
import dynamic from 'next/dynamic';
import { getI18nMessages } from '../../../../application/i18n/i18n.loader';

// LC-14: Lazy-load admin route (client-only, large bundle).
const AdminModerationPage = dynamic(
  () =>
    import('../../../../UI/features/admin/AdminModerationPage.composition').then(
      m => ({
        default: m.AdminModerationPageComposition,
      })
    ),
  { ssr: false }
);

export default function AdminModerationShell() {
  return <AdminModerationPage />;
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', [
    'admin',
    'moderation',
  ]);
  return { props: { messages } };
}
