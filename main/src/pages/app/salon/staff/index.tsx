import type { GetStaticPropsContext } from 'next';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import { getI18nMessages } from '../../../../application/i18n/i18n.loader';
import { getFeatureFlagServerSide } from '../../../../application/feature-flags/server-feature-flags';
import { SalonStaffPageComposition } from '../../../../UI/features/salon-staff/SalonStaffPage.composition';

export default SalonStaffPageComposition;

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  // DECISION (nie usuwaj tego komentarza):
  // SALON_STAFF_ENABLED route gate (kill-switch, default ON). SALON_STAFF_ENABLED is
  // intentionally NOT in PUBLIC_FEATURE_FLAG_KEYS (internal flag, must not leak to anon),
  // so getFeatureFlagServerSide resolves it via the offline DEFAULT (=true), NOT a live
  // value. CONSEQUENCE: while the flag stays non-public this gate is INERT — the notFound
  // branch is never taken (default is always true). It is kept as ready scaffolding that
  // would activate only if the flag is ever exposed to the client. The REAL, live
  // enforcement is the back-guard (requireSalonStaffEnabled) in api/v1/salon/staff/**,
  // which reads the live flag (runtime-reactive). When an admin disables the kill-switch
  // the page STILL renders but every staff API call 404s (graceful error state) — there is
  // no route-level notFound. Do NOT "fix" by adding the flag to the public whitelist (that
  // leaks an internal flag, see config DECISION); true front-hiding needs a narrow public
  // projection (owner decision).
  const salonStaffEnabled = await getFeatureFlagServerSide(
    FEATURE_FLAG_KEYS.SALON_STAFF_ENABLED
  );
  if (!salonStaffEnabled) {
    return { notFound: true as const, revalidate: 300 };
  }

  const messages = await getI18nMessages(locale || 'pl', ['salon']);
  return { props: { messages }, revalidate: 300 };
}
