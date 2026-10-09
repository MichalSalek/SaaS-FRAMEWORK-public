import { useRef, type ReactNode } from 'react';
import clsx from 'clsx';
import { EyebrowAtom } from '../Eyebrow/Eyebrow.atom';
import { useReportHeroVisibility } from './useReportHeroVisibility';
import styles from './AppHero.module.css';

export interface AppHeroProps {
  /** Nagłówek ekranu (display serif). */
  title: ReactNode;
  /**
   * Akcent tytułu w kolorze marki, renderowany po `title` po zwykłej spacji.
   * DECISION (nie usuwaj tego komentarza) — owner 2026-10-08: kropka środkowa
   * jako interpunkcja jest zakazana („Twoja galeria · Ania” czyta się jak
   * skład z automatu), więc separatora nie ma i akcent MUSI być gramatycznym
   * ciągiem dalszym tytułu („Stylizacje z całej Polski”), nie apozycją.
   */
  accent?: string;
  /**
   * Złoty akcent BEZ separatora — gramatyczna kontynuacja tytułu
   * („Twoja kolekcja inspiracji", „Chcesz odejść?"). Wyklucza się z accent.
   */
  accentInline?: string;
  /**
   * Chip-eyebrow nad tytułem. Na ekranach NARZĘDZIA i funnelu NIE podawaj
   * tautologicznego type-labela (S25/1D + S86 + S88). Prop zostaje dla
   * admin chrome („ADMIN · …") i wyjątków, które kodują stan/filtr.
   */
  eyebrow?: string;
  /** Zdanie wprowadzające pod tytułem. */
  subtitle?: ReactNode;
  /**
   * Rząd żywych meta-danych (sans, accent-fg) — alternatywa dla
   * marketingowego subtitle: konkret zamiast obietnicy („12 prac · ostatnia
   * wczoraj"). Zasada gustu: konkret > rozmycie.
   */
  meta?: ReactNode;
  /**
   * Slot po prawej (np. avatar profilu) — element tożsamości ekranu ŻYJE
   * w karcie, nie jako osierocony pasek pod nią (fresh-eyes S25).
   */
  aside?: ReactNode;
  className?: string;
}

/**
 * Kanoniczna karta-intro ekranu aplikacji (S25): zamknięty prostokąt na
 * gold-tincie z pełną hairline ramą (owner 2026-08-18: zero sparkle/gwiazdek).
 * Floor-compliant — zero gradientów.
 *
 * Gęstość ustala strona przez to, KTÓRE propsy poda (eyebrow/subtitle/meta
 * są opcjonalne) — konwencję gęstości per typ ekranu rozstrzyga głos ownera
 * (playground S25). Liczby w meta zawsze w sans (Marcellus renderuje 0 jak
 * literę O — lekcja S25).
 */
export function AppHeroOrganism({
  title,
  accent,
  accentInline,
  eyebrow,
  subtitle,
  meta,
  aside,
  className,
}: AppHeroProps) {
  /* Raportuj widoczność karty-intro do AppLayout, by top-bar wygaszał
   * zdublowany tytuł (głos S27/2 = B). Mechanizm współdzielony z onboardingiem
   * przez useReportHeroVisibility (obserwator + scroll-root #main-content). */
  const rootRef = useRef<HTMLElement | null>(null);
  useReportHeroVisibility(rootRef);

  return (
    <header
      ref={rootRef}
      data-app-hero=''
      className={clsx(styles.hero, className)}>
      <div className={styles.body}>
        {eyebrow ? (
          <div className={styles.eyebrowRow} aria-hidden='true'>
            <EyebrowAtom variant='chip'>{eyebrow}</EyebrowAtom>
          </div>
        ) : null}
        <h1 className={styles.title}>
          {title}
          {accent ? (
            <>
              {' '}
              <span className={styles.titleAccent}>{accent}</span>
            </>
          ) : null}
          {accentInline ? (
            <>
              {' '}
              <span className={styles.titleAccent}>{accentInline}</span>
            </>
          ) : null}
        </h1>
        {subtitle != null ? (
          <p className={styles.subtitle}>{subtitle}</p>
        ) : null}
        {meta != null ? <div className={styles.meta}>{meta}</div> : null}
      </div>
      {aside != null ? <div className={styles.aside}>{aside}</div> : null}
    </header>
  );
}
