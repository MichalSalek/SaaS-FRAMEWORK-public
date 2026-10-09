import type { GetServerSidePropsContext } from 'next';
import { useRouter } from 'next/router';
import { getI18nMessages } from '../../../application/i18n/i18n.loader';
import { PhotoDetailPageComposition } from '../../../UI/features/gallery/PhotoDetailPage.composition';

interface Props {
  photoId: string;
}

export default function PhotoDetailShell({ photoId }: Props) {
  const router = useRouter();
  // DECISION (nie usuwaj tego komentarza):
  // Client-side NVT push zmienia URL zanim GSSP odda nowe props. Sesje/inbox
  // czytają `router.query`; photo brało TYLKO GSSP `photoId` → puste/stare id
  // = skeleton albo biały not-found (S87 residual, klik z galerii/explore).
  const id =
    typeof router.query.id === 'string' && router.query.id.length > 0
      ? router.query.id
      : photoId;
  return <PhotoDetailPageComposition photoId={id} />;
}

export async function getServerSideProps({
  locale,
  params,
}: GetServerSidePropsContext) {
  const photoId = params?.id as string | undefined;

  if (!photoId) {
    return { notFound: true as const };
  }

  const messages = await getI18nMessages(locale ?? 'pl', [
    'pages.gallery',
    'galleryCard',
    'galleryStrength',
    'galleryFilter',
    // ReportModal (viewer-only, logged-in) uses useTranslations('moderation.report').
    // Without this namespace every key renders raw (moderation.report.title, ...) —
    // a broken modal for any client who clicks "Zgłoś" on a photo (S65a class:
    // component reads a namespace not guaranteed on its host page).
    'moderation',
  ]);
  return { props: { messages, photoId } };
}
