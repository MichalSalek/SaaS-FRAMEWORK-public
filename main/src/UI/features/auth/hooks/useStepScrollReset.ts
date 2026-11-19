// UI/features/auth/hooks/useStepScrollReset.ts
// Scroll reset to the top on EVERY step change (and on entering success). Without it the scroll
// position of the previous step carries over: after scrolling the ROLE step down to the consents
// and clicking „Dalej" the user lands mid-way down the DATA step without seeing its hero + heading
// (disorientation in the funnel). #main-content = the AppLayout scroll container.
// Extracted from OnboardingPage.composition to keep it under the 300-line cap.
//
// Focus rescue (same effect, same trigger): the step card is keyed by step, so
// when focus sat INSIDE the old card (Enter in the last text field advances the
// step, see advanceOnEnterKey) or on a control that only one step renders (the
// Next button is gone on CHECKOUT, the whole form is gone on success), the
// focused node unmounts and focus falls to <body>. The next Enter then does
// nothing and a screen reader loses its place. Only a LOST focus is moved: a
// Next button that survives the transition keeps it, as before.

import { useEffect, useRef } from 'react';

/** DOM id of the element that takes focus after a step change lost it: the
 *  step card, or the success card on the terminal view (never both mounted). */
export const ONBOARDING_FOCUS_TARGET_ID = 'onboarding-focus-target';

/** Props for the step card: the focus-rescue target (see header). */
export interface StepFocusTargetProps {
  id: string;
  tabIndex: -1;
}

export function useStepScrollReset(
  currentStep: number,
  showSuccess: boolean
): StepFocusTargetProps {
  // The view this effect last ran for. On mount nothing was lost (focus is on
  // <body> only because the page just loaded), so the rescue must not pull a
  // screen reader past the hero heading into the card; the same key also
  // skips StrictMode's second mount pass.
  const lastViewRef = useRef(`${currentStep}:${String(showSuccess)}`);
  useEffect(() => {
    const scroller = document.getElementById('main-content');
    // DECISION: `behavior: 'auto'`. The global `scroll-behavior: smooth` would animate the step
    // reset and leave the funnel halfway down the next screen (mainScrollTop=48 after a role
    // change). Instant, like the route reset and explore scroll-restore.
    // Desktop onboarding scrolls the window (the main is not a scrollport). The
    // phone shell scrolls `#main-content`. Reset both; a no-op on the one that
    // did not move.
    if (scroller) {
      scroller.scrollTo({ top: 0, behavior: 'auto' });
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
    const view = `${currentStep}:${String(showSuccess)}`;
    if (view === lastViewRef.current) {
      return;
    }
    lastViewRef.current = view;
    const active = document.activeElement;
    if (active === null || active === document.body) {
      document
        .getElementById(ONBOARDING_FOCUS_TARGET_ID)
        ?.focus({ preventScroll: true });
    }
  }, [currentStep, showSuccess]);
  return { id: ONBOARDING_FOCUS_TARGET_ID, tabIndex: -1 };
}
