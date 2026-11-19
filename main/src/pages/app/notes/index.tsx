import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../../application/i18n/i18n.loader';
import { NotesPageComposition } from '../../../UI/features/notes/NotesPage.composition';

export default NotesPageComposition;

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale || 'pl', [
    'pages.notes',
    'account.profile',
    'account.profileManage',
    // The general note reuses the dashboard note field (its load and save errors).
    'dashboard',
  ]);
  return { props: { messages } };
}
