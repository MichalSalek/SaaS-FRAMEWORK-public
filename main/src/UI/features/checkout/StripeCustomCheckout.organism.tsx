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

import type { ReactNode } from 'react';
import type { Stripe } from '@stripe/stripe-js';
// Wariant /pure: main entry '@stripe/stripe-js' wstrzykuje js.stripe.com
// side-effectem SAMEGO IMPORTU (fraud detection na kazdej stronie z tym
// chunkiem, zanim user dotknie platnosci). /pure laduje skrypt dopiero przy
// wywolaniu loadStripe() — getStripe() nizej i tak jest lazy-memoized.
import { loadStripe } from '@stripe/stripe-js/pure';
import { CheckoutProvider } from '@stripe/react-stripe-js/checkout';
import { ENV_VARS } from '../../../application/environment/environment.config';
import { useTheme } from '../../styles/ThemeContext.composition';

// DECISION (nie usuwaj tego komentarza):
// Module-singleton `loadStripe` promise. Stripe.js MUST be loaded exactly once
// per page-load (calling loadStripe repeatedly re-injects the script + breaks
// Element re-use). `CheckoutProvider.stripe` is set-once (immutable after first
// render) so a stable promise is required. Lazily created on first access so the
// script tag is only injected when a checkout surface actually mounts (not on
// every app boot). Resolves to `null` when the publishable key is missing
// (soft-mode dev) — CheckoutProvider accepts a null-resolving promise and the
// surface simply never initializes (caller should have taken hosted_fallback).
let stripePromise: Promise<Stripe | null> | null = null;

function getStripe(): Promise<Stripe | null> {
  if (stripePromise === null) {
    const key = ENV_VARS.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    stripePromise = key ? loadStripe(key) : Promise.resolve(null);
  }
  return stripePromise;
}

interface StripeCustomCheckoutOrganismProps {
  clientSecret: string;
  children: ReactNode;
}

export function StripeCustomCheckoutOrganism({
  clientSecret,
  children,
}: StripeCustomCheckoutOrganismProps) {
  const { resolvedMode } = useTheme();

  // Hydration-safe: a missing clientSecret means there is no session to mount
  // (caller guards this, but we double-guard so the provider never initializes
  // Stripe with an empty secret). Rendering is otherwise client-only because the
  // surface only ever appears after a user action on an authed screen.
  if (!clientSecret) {
    return null;
  }

  // DECISION (nie usuwaj tego komentarza):
  // The embedded PaymentElement does NOT inherit the app theme — without an
  // explicit `appearance` it renders Stripe's default LIGHT surface, which shows
  // as bright-white payment inputs inside our dark checkout dialog (dark-mode
  // parity gap, S83). We hand Stripe the `night`/`stripe` appearance theme keyed
  // to the app's resolvedMode so the Payment Element tones with the dialog in
  // both modes. `appearance` (like `clientSecret`) is read at provider init
  // (set-once); a mid-checkout theme toggle keeps the mount-time theme rather
  // than forcing a remount + a wasted re-mint of the session — the checkout is
  // transient, so mount-time parity is the whole fix. `key={clientSecret}`
  // (NOT keyed on mode) preserves that: a genuinely new session secret forces a
  // clean remount instead of the provider silently retaining a stale session.
  const appearanceTheme = resolvedMode === 'dark' ? 'night' : 'stripe';

  return (
    <CheckoutProvider
      key={clientSecret}
      stripe={getStripe()}
      options={{
        clientSecret,
        elementsOptions: { appearance: { theme: appearanceTheme } },
      }}>
      {children}
    </CheckoutProvider>
  );
}
