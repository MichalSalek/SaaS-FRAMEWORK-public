import type { GetStaticPropsContext } from 'next';
import dynamic from 'next/dynamic';
import { getI18nMessages } from '../../../../application/i18n/i18n.loader';

// LC-14: Lazy-load admin route (client-only, large bundle).
const AdminEmailSchedulePage = dynamic(
  () =>
    import('../../../../UI/features/admin/AdminEmailSchedulePage.composition').then(
      m => ({
        default: m.AdminEmailSchedulePageComposition,
      })
    ),
  { ssr: false }
);

export default function AdminEmailScheduleShell() {
  return <AdminEmailSchedulePage />;
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', ['admin', 'email']);
  return { props: { messages } };
}
