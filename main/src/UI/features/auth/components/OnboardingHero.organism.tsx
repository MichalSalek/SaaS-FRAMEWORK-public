// UI/features/auth/components/OnboardingHero.organism.tsx
//
// The intro card of the onboarding WELCOME step (heading + one sentence).
//
// DECISION (nie usuwaj tego komentarza) — vote `s126-proces`, owner 2026-10-09
// (with his decisions of 2026-10-08): step-by-step processes lose the intro
// card, and the WELCOME step of onboarding is the one screen that KEEPS it.
// From the second step on the page renders the shared `ProcessHeaderMolecule`
// instead (title in the top bar, the compact step indicator starts the
// screen). The step pill („2 / 5 Dane”) that used to sit in this card went
// away with the local stepper: position is the indicator's job alone.
//
// DECISION (nie usuwaj tego komentarza):
// Ten komponent istnieje po to, by wywołać `useReportHeroVisibility` WEWNĄTRZ
// poddrzewa AppLayoutu (a więc w zasięgu `AppHeroVisibilityContext.Provider`).
// Wcześniej hook był wołany w `OnboardingPageComposition` — komponencie, który
// RENDERUJE `<AppLayoutComposition>`, więc był RODZICEM providera, nie dzieckiem.
// `useReportAppHeroVisibility()` czytał wtedy kontekst SPRZED AppLayoutu i
// dostawał no-op fallback → `setHeroTitleSuppressed` nigdy nie odpalał → tytuł
// w top-barze był widoczny ZAWSZE (zamiast wjeżdżać dopiero po przescrollowaniu
// hero). Renderowany jako dziecko `<form>` (= children AppLayoutu) hook trafia na
// właściwy provider — dokładnie tak, jak kanoniczny `AppHeroOrganism` co-lokuje
// hook ze swoim markupem. To domyka „identyczne zachowanie na każdym ekranie".

import type { ReactNode } from 'react';
import { useRef } from 'react';
import { useReportHeroVisibility } from '../../../components/AppHero/useReportHeroVisibility';
import styles from '../OnboardingPage.module.css';

interface OnboardingHeroProps {
  /** Nagłówek powitania. */
  title: ReactNode;
  /** Akcent tytułu — gramatyczna kontynuacja (bez separatora). */
  accent: ReactNode;
  /** Zdanie wprowadzające pod tytułem. */
  subtitle: ReactNode;
}

export function OnboardingHeroOrganism({
  title,
  accent,
  subtitle,
}: OnboardingHeroProps) {
  // Co-lokacja obserwatora widoczności hero z jego markupem (jak AppHeroOrganism),
  // wewnątrz poddrzewa AppLayout providera — patrz DECISION nad plikiem. Od
  // drugiego kroku i na widoku „success” ten komponent się odmontowuje, a
  // cleanup hooka raportuje false i odsłania tytuł w top-barze (nie trzeba
  // flagi enabled — komponent po prostu znika, gdy karta ma zniknąć).
  const heroRef = useRef<HTMLElement | null>(null);
  useReportHeroVisibility(heroRef);

  return (
    <header ref={heroRef} className={styles.hero}>
      <h1 className={styles.heroTitle}>
        {title} <span className={styles.heroTitleAccent}>{accent}</span>
      </h1>
      <p className={styles.heroSubtitle}>{subtitle}</p>
    </header>
  );
}
