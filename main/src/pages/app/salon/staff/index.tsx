import type { GetStaticPropsContext } from 'next';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import { getI18nMessages } from '../../../../application/i18n/i18n.loader';
import { getFeatureFlagServerSide } from '../../../../application/feature-flags/server-feature-flags';
import { SalonStaffPageComposition } from '../../../../UI/features/salon-staff/SalonStaffPage.composition';

export default SalonStaffPageComposition;

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  // DECISION: this SALON_STAFF_ENABLED route gate is currently INERT. The flag is intentionally NOT in
  // PUBLIC_FEATURE_FLAG_KEYS (internal flag, must not leak to anon), so getFeatureFlagServerSide
  // resolves it via the offline DEFAULT (true) and the notFound branch is never taken; it activates
  // only if the flag is ever exposed to the client. The REAL, live enforcement is the back guard
  // (requireSalonStaffEnabled) in api/v1/salon/staff/**, which reads the live flag: with the
  // kill-switch off the page still renders but every staff API call 404s (graceful error state).
  // Do NOT "fix" by adding the flag to the public whitelist (leaks an internal flag, see the
  // DECISION in feature-flags.config); true front-hiding needs a narrow public projection (owner
  // decision).
  const salonStaffEnabled = await getFeatureFlagServerSide(
    FEATURE_FLAG_KEYS.SALON_STAFF_ENABLED
  );
  if (!salonStaffEnabled) {
    return { notFound: true as const, revalidate: 300 };
  }

  // Members see the salon gallery here (SalonMemberTeams): card and filters.
  const messages = await getI18nMessages(locale || 'pl', [
    'salon',
    'galleryFilter',
    'galleryUI',
    'galleryCard',
    // The invite dialog's e-mail error (SalonStaffDialogs).
    'validation',
  ]);
  return { props: { messages }, revalidate: 300 };
}
