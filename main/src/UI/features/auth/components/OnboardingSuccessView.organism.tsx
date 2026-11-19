// UI/features/auth/components/OnboardingSuccessView.organism.tsx
//
// Terminal onboarding view together with its shell. Split out of the composition after the draft and
// the drawer role were added: the composition exceeded the 300-line limit, and this was its only
// RENDER branch that is not a funnel step.
//
// DECISION: the shell (`AppLayoutComposition`) travels WITH the view instead of staying in the
// composition, because both render branches set exactly the same three things (hidden bottom
// navigation, hidden app-shell "back", drawer role from the choice). Splitting them ended with one
// branch getting a prop and the other not, which is how the drawer showed "Klientka" through the
// whole stylist onboarding.

import { AppLayoutComposition } from '../../../layouts/AppLayout.composition';
import { OnboardingStepSuccessOrganism } from './OnboardingStepSuccess.organism';
import type { OnboardingRole } from '../onboarding.types';
import styles from '../OnboardingPage.module.css';

interface OnboardingSuccessViewProps {
  /** The role the funnel closed on (drives the content and the drawer). */
  role: OnboardingRole;
  /** Title in the top bar (the same mechanism as on the steps). */
  navTitle: string;
  /** Entering the app — a conscious click, never an auto-redirect. */
  onEnterApp: () => void;
  /** Stylist: the first work (the screen's main action). */
  onAddFirstPhoto: () => void;
  /** Stylist on confirmed Free: the pay page. Ignored for a client. */
  onChoosePlan: () => void;
  /** Confirmed Free stylist completion. Never true for a client. */
  offerPaidPlan: boolean;
  /** Client: scanning the stylist's code (the screen's main action). */
  onScanStylist: () => void;
  /** The client came from a stylist profile: the main action returns to it. */
  returnToStylistProfile: boolean;
  /** The profile return opens a free conversation rather than requesting a connection. */
  returnToMessage?: boolean;
}

export function OnboardingSuccessViewOrganism({
  role,
  navTitle,
  onEnterApp,
  onAddFirstPhoto,
  onChoosePlan,
  offerPaidPlan,
  onScanStylist,
  returnToStylistProfile,
  returnToMessage = false,
}: OnboardingSuccessViewProps) {
  return (
    <AppLayoutComposition
      title={navTitle}
      hideBottomNav
      hideBackButton
      drawerRole={role}>
      <div className={styles.frame} data-fill-shell='' data-layout='flow'>
        <div className={styles.page}>
          <div className={styles.shell}>
            {/* DECISION: the public link card left this view. Onboarding no longer asks for the
              name and city, so right after it the profile is empty and a link to it promises
              nothing; the card after the first photo asks for them and leads to the link from
              there. (owner) */}
            <OnboardingStepSuccessOrganism
              role={role}
              onEnterApp={onEnterApp}
              onAddFirstPhoto={onAddFirstPhoto}
              onChoosePlan={onChoosePlan}
              offerPaidPlan={offerPaidPlan}
              onScanStylist={onScanStylist}
              returnToStylistProfile={returnToStylistProfile}
              returnToMessage={returnToMessage}
            />
          </div>
        </div>
      </div>
    </AppLayoutComposition>
  );
}
