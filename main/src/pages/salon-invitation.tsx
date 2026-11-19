import type { GetStaticPropsContext } from 'next';
import { getPublicPageMessages } from '../application/i18n/i18n.loader';
import { PUBLIC_PAGE_MESSAGES } from '../application/i18n/page-messages.config';
export { SalonInvitationAcceptPageComposition as default } from '../UI/features/salon-staff/SalonInvitationAcceptPage.composition';
export async function getStaticProps({ locale }: GetStaticPropsContext) {
  return {
    props: {
      messages: (
        await getPublicPageMessages(
          locale ?? 'pl',
          PUBLIC_PAGE_MESSAGES['/salon-invitation']
        )
      ).messages,
    },
  };
}
