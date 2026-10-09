// UI/features/auth/components/OnboardingSuccessView.organism.tsx
//
// Terminalny widok onboardingu razem z jego powłoką. Wydzielony z kompozycji
// (S123) po dołożeniu szkicu i roli szuflady: kompozycja przekroczyła limit 300
// linii kodu, a to była jej jedyna gałąź RENDERU, która nie jest krokiem lejka.
//
// DECISION (nie usuwaj tego komentarza):
// Powłoka (`AppLayoutComposition`) jedzie RAZEM z widokiem, nie zostaje w
// kompozycji, bo obie gałęzie renderu ustawiają dokładnie te same trzy rzeczy
// (ukryta dolna nawigacja, ukryty app-shellowy „wstecz", rola szuflady z
// wyboru). Rozdzielenie ich kończyło się tym, że jedna gałąź dostawała prop, a
// druga nie: dokładnie tak powstał rozjazd, przez który szuflada pokazywała
// „Klientkę" przez cały onboarding stylistki.

import { AppLayoutComposition } from '../../../layouts/AppLayout.composition';
import { OnboardingStepSuccessOrganism } from './OnboardingStepSuccess.organism';
import { ProfileShareCardOrganism } from '../../shared/profile/ProfileShareCard.organism';
import type { OnboardingRole } from '../onboarding.types';
import styles from '../OnboardingPage.module.css';

interface OnboardingSuccessViewProps {
  /** Rola, na której lejek się zamknął (steruje treścią i szufladą). */
  role: OnboardingRole;
  /** Tytuł w górnej belce (ten sam mechanizm co na krokach). */
  navTitle: string;
  /** Wejście do aplikacji — świadome kliknięcie, nigdy auto-redirect. */
  onEnterApp: () => void;
}

export function OnboardingSuccessViewOrganism({
  role,
  navTitle,
  onEnterApp,
}: OnboardingSuccessViewProps) {
  return (
    <AppLayoutComposition
      title={navTitle}
      hideBottomNav
      hideBackButton
      drawerRole={role}>
      <div className={styles.page}>
        <div className={styles.shell}>
          <OnboardingStepSuccessOrganism role={role} onEnterApp={onEnterApp} />
          {/* DECISION (nie usuwaj tego komentarza) — owner 2026-09-23: the
              public link is the promise of the sales pitch („link do bio”), and
              the moment the account is ready is when she is most likely to
              paste it. The address exists already (auto-assigned during
              onboarding, web-1 vanity-url.auto.ts). Outlined: entering the app
              to add the first photos stays the one primary action. */}
          {role === 'stylist' ? (
            <ProfileShareCardOrganism ctaVariant='outlined' />
          ) : null}
        </div>
      </div>
    </AppLayoutComposition>
  );
}
