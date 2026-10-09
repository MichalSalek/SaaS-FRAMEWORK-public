import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../../application/i18n/i18n.loader';
import { OnboardingPageComposition } from '../../../UI/features/auth/OnboardingPage.composition';

// Thin shell — the feature component carries its own <AppLayout> (the one
// canonical "who mounts the layout" pattern; see UI_ARCHITECTURE.md §Layout).
export default function OnboardingShellPage() {
  return <OnboardingPageComposition />;
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const messages = await getI18nMessages(locale ?? 'pl', [
    'pages.onboarding',
    // SPE: checkout step (stylist) mounts PlanCheckoutPanel which consumes
    // 'account.checkout' (tx bag) + 'account.plan' (usePricingPlans summary).
    // Without this the entire embedded-payment surface renders MISSING_MESSAGE.
    'account',
    'validation',
  ]);
  return { props: { messages } };
}
