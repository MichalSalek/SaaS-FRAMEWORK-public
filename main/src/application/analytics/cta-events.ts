import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  billingMarketProperties,
  type BillingMarketAnalytics,
} from './billing-market.analytics';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import { clarity, emitAnalyticsEvent as emit } from './analytics-sinks';
import { updateFirstTouch } from './first-touch';

export { trackAuthStarted } from './auth-events';
export { trackDemoInteraction } from './demo-events';
export { trackSignupCompleted } from './signup-completed';
export { resolvePageKind } from './analytics-page-kind';

/**
 * Place of the CTA on the page. A union of literals, not `string`: a typo in the location
 * („hero-stylists" instead of „stylists-hero") is not visible in the UI, only a silent
 * mismatch in a report that surfaces a month later.
 */
export type CtaLocation =
  // home page
  | 'home-hero'
  | 'home-mid'
  | 'home-demo'
  | 'home-showcase'
  | 'home-bottom'
  | 'home-sticky'
  | 'home-chat'
  // for stylists
  | 'stylists-hero'
  | 'stylists-mid'
  | 'stylists-final'
  | 'stylists-sticky'
  | 'stylists-pricing-preview'
  | 'stylists-pricing-link'
  | 'stylists-clients-link'
  | 'stylists-compare-link'
  // for salons
  | 'studios-hero'
  | 'studios-final'
  | 'studios-sticky'
  | 'studios-pricing-preview'
  | 'studios-pricing-link'
  | 'studios-stylists-link'
  // for clients
  | 'clients-hero'
  | 'clients-mid'
  | 'clients-sticky'
  // pricing
  | 'pricing-tier'
  | 'pricing-final'
  | 'pricing-sticky'
  | 'pricing-compare-link'
  | 'pricing-scale'
  // comparison
  | 'compare-hero'
  | 'compare-final'
  | 'compare-sticky'
  | 'compare-pricing-link'
  | 'compare-stylists-link'
  // about
  | 'about-login'
  | 'about-client'
  | 'about-sticky'
  | 'about-pricing-link'
  // app
  | 'get-app-hero'
  | 'get-app-demo'
  | 'get-app-final'
  | 'get-app-mid'
  | 'get-app-sticky'
  | 'get-app-stylists-link'
  | 'get-app-pricing-link'
  // help
  | 'help-center-contact'
  | 'help-center-sticky'
  | 'help-center-after'
  // blog
  | 'blog-after-post'
  | 'blog-mid-post'
  | 'blog-index-footer'
  // contact
  | 'contact-form'
  | 'contact-final'
  | 'contact-sticky';

/** Click on any CTA on a static page. Intent, not conversion. */
export function trackCtaClick(
  location: CtaLocation,
  plan?: PricingPlan | null
): void {
  emit('cta_click', { location, ...(plan != null ? { plan } : {}) });
  clarity('set', 'cta_clicked', location);
  clarity('event', 'cta_click');
}

/**
 * Entering signup. DELIBERATELY not mapped to `generate_lead` in GA4: clicking „załóż konto" is
 * not an acquired lead, and an inflated conversion is worse than none because the report then
 * looks healthy.
 */
export function trackSignupStarted(
  location: CtaLocation,
  plan?: PricingPlan | null
): void {
  updateFirstTouch({ cta: location });
  emit('signup_started', { location, ...(plan != null ? { plan } : {}) });
  clarity('set', 'signup_started', 'true');
  // Raise recording priority for sessions that reach registration.
  clarity('upgrade', 'signup_started');
}

/** Plan choice on the pricing page. Lands in GA4 as `select_item`. */
export function trackPricingPlanClicked(
  plan: PricingPlan,
  billingPeriod: BillingPeriod,
  location: CtaLocation = 'pricing-tier',
  market?: BillingMarketAnalytics
): void {
  emit('pricing_plan_clicked', {
    plan,
    ...billingMarketProperties({
      ...market,
      billingPeriod,
      ...(plan === PricingPlanValue.FREE ? { currency: undefined } : {}),
    }),
    location,
  });
}

/**
 * Click on an internal link in content. An edge of the transition graph: says WHAT someone
 * clicked to go further, which a page view alone does not. See UI/hooks/useInternalLinkTracking.
 */
export function trackInternalLinkClick(target: string): void {
  emit('internal_link_click', { target });
}

/** Scroll thresholds: 25 / 50 / 75 / 100 percent. */
export type ScrollDepth = 25 | 50 | 75 | 100;

/** See UI/hooks/useScrollDepth for the rationale of the thresholds. */
export function trackScrollDepth(depth: ScrollDepth): void {
  emit('scroll_depth', { depth });
}

/**
 * Newsletter signup. Also a lead, so it has the same GA4 name as the contact form; they are told
 * apart by `cta_location` taken from `consentSource`.
 */
export function trackNewsletterSignup(source: string): void {
  emit('contact_form_submitted', { location: source });
}

/** Submitted contact form. This IS a lead: `generate_lead` in GA4. */
export function trackContactFormSubmitted(): void {
  emit('contact_form_submitted', { location: 'contact-form' });
}

/**
 * Wraps a navigation handler with measurement. The event goes BEFORE navigation, but sending is
 * non-blocking (PostHog and GTM queue), so the transition does not wait for the network.
 * Arguments are ignored on purpose: the wrapper goes straight into `onClick`, so React passes an
 * event object here that we do not want in the data.
 */
export function withCtaTracking(
  location: CtaLocation,
  handler: () => void
): () => void {
  return () => {
    trackCtaClick(location);
    handler();
  };
}

/** As above, for a CTA that leads to signup. */
export function withSignupTracking(
  location: CtaLocation,
  handler: () => void,
  plan?: PricingPlan | null
): () => void {
  return () => {
    trackSignupStarted(location, plan);
    handler();
  };
}
