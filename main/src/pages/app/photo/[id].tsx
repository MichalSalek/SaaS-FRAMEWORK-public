import type { GetServerSidePropsContext } from 'next';
import { useRouter } from 'next/router';
import { getI18nMessages } from '../../../application/i18n/i18n.loader';
import { PhotoDetailPageComposition } from '../../../UI/features/gallery/PhotoDetailPage.composition';

interface Props {
  photoId: string;
}

export default function PhotoDetailShell({ photoId }: Props) {
  const router = useRouter();
  // DECISION: a client-side navigation push changes the URL before GSSP delivers new props. Sessions/inbox
  // read `router.query`; photo took ONLY the GSSP `photoId`, so a click from the gallery/explore
  // gave an empty or stale id (skeleton or a blank not-found).
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
    // Without this namespace every key renders raw (moderation.report.title, ...), a broken modal
    // for any client who clicks "Zgłoś" on a photo.
    'moderation',
  ]);
  return { props: { messages, photoId } };
}
