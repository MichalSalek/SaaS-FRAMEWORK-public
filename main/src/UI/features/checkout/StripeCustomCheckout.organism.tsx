// UI/features/checkout/StripeCustomCheckout.organism.tsx
//
// SPE (W2): mounts the Stripe "custom" Checkout surface (ui_mode:'custom').
// The backend creates the Checkout Session and returns a `clientSecret`; this
// provider wraps the embedded `<PaymentElement/>` + summary that live inside
// PlanCheckoutPanel. NOT `EmbeddedCheckoutProvider` (that renders ALL Stripe UI
// in an iframe — the opposite of the native-feel SPE pattern: here only the
// payment INPUTS are iframed, the surrounding UI is ours).
//
// Stack: @stripe/react-stripe-js/checkout (v5) + @stripe/stripe-js (v8).

import { useState, type ReactNode } from 'react';
import type { Stripe, StripeCheckoutOptions } from '@stripe/stripe-js';
import type { CountryCode } from '@kernel/domain/localization/country.config';
import type { BillingProfile } from '@kernel/domain/account/billing-profile.contract-schemas';
import { checkoutBillingDefault } from './checkout-billing-default';
// Wariant /pure: main entry '@stripe/stripe-js' wstrzykuje js.stripe.com
// side-effectem SAMEGO IMPORTU (fraud detection na kazdej stronie z tym
// chunkiem, zanim user dotknie platnosci). /pure laduje skrypt dopiero przy
// wywolaniu loadStripe() — getStripe() nizej i tak jest lazy-memoized.
import { loadStripe } from '@stripe/stripe-js/pure';
import { CheckoutProvider } from '@stripe/react-stripe-js/checkout';
import { ENV_VARS } from '../../../application/environment/environment.config';
import { useTheme } from '../../styles/ThemeContext.composition';

// DECISION: module-singleton `loadStripe` promise. Stripe.js MUST load exactly once per page load
// (repeated loadStripe re-injects the script and breaks Element re-use), and
// `CheckoutProvider.stripe` is set-once, so a stable promise is required. Created lazily on first
// access, so the script tag is injected only when a checkout surface actually mounts, not on every
// app boot. Resolves to `null` when the publishable key is missing (soft-mode dev);
// CheckoutProvider accepts that and the surface simply never initializes (the caller should have
// taken hosted_fallback).
let stripePromise: Promise<Stripe | null> | null = null;

function getStripe(): Promise<Stripe | null> {
  if (stripePromise === null) {
    const key = ENV_VARS.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    stripePromise = key
      ? loadStripe(key).catch(error => {
          stripePromise = null;
          throw error;
        })
      : Promise.resolve(null);
  }
  return stripePromise;
}

interface StripeCustomCheckoutOrganismProps {
  clientSecret: string;
  children: ReactNode;
  billingCountry?: CountryCode;
  billingProfile?: BillingProfile;
}

export function StripeCustomCheckoutOrganism(
  props: StripeCustomCheckoutOrganismProps
) {
  if (!props.clientSecret) {
    return null;
  }
  return <StripeCheckoutSession key={props.clientSecret} {...props} />;
}

function StripeCheckoutSession({
  clientSecret,
  children,
  billingCountry,
  billingProfile,
}: StripeCustomCheckoutOrganismProps) {
  const { resolvedMode } = useTheme();
  // DECISION: the embedded PaymentElement does NOT inherit the app theme; without an explicit
  // `appearance` it renders Stripe's default LIGHT surface, bright-white inputs inside our dark
  // checkout dialog. We hand Stripe the `night`/`stripe` theme keyed to the app's resolvedMode.
  // Appearance, country and customer defaults are read at provider init (set-once). A theme or
  // profile refresh does not remount an active checkout; a new session secret does.
  // CheckoutProvider options are initialization-only. Freeze country and profile
  // for this session so a background refetch cannot overwrite the buyer's edits.
  const [options] = useState<StripeCheckoutOptions>(() => {
    const billingAddress = checkoutBillingDefault(
      billingCountry,
      billingProfile
    );
    return {
      clientSecret,
      elementsOptions: {
        appearance: { theme: resolvedMode === 'dark' ? 'night' : 'stripe' },
      },
      ...(billingAddress && { defaultValues: { billingAddress } }),
    };
  });
  return (
    <CheckoutProvider stripe={getStripe()} options={options}>
      {children}
    </CheckoutProvider>
  );
}
