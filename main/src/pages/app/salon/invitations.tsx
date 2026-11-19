import type { GetStaticPropsContext } from 'next';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import { getI18nMessages } from '../../../application/i18n/i18n.loader';
import { getFeatureFlagServerSide } from '../../../application/feature-flags/server-feature-flags';
import { SalonInvitationsPageComposition } from '../../../UI/features/salon-staff/SalonInvitationsPage.composition';

export default SalonInvitationsPageComposition;

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  // Same SALON_STAFF_ENABLED route gate as pages/app/salon/staff (inert while
  // the flag is non-public; the live enforcement is the API back-guard). DECISION
  // with the full reasoning lives there.
  const salonStaffEnabled = await getFeatureFlagServerSide(
    FEATURE_FLAG_KEYS.SALON_STAFF_ENABLED
  );
  if (!salonStaffEnabled) {
    return { notFound: true as const, revalidate: 300 };
  }

  const messages = await getI18nMessages(locale || 'pl', ['salon']);
  return { props: { messages }, revalidate: 300 };
}
