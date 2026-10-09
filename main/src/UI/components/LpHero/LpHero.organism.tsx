import type { ReactNode } from 'react';
import clsx from 'clsx';
import { EyebrowAtom } from '../Eyebrow/Eyebrow.atom';
import styles from './LpHero.module.css';

export interface LpHeroProps {
  /** Renderowany przez <Eyebrow variant='chip'>. */
  eyebrow?: ReactNode;
  /**
   * Eyebrow bywa h1 (SEO) — strona decyduje. Gdy 'h1', headline schodzi
   * na <h2> (wzorzec home/for-stylists: SEO keyword w semantycznym h1-chipie,
   * głos marki w h2; dokładnie jeden <h1> na stronę).
   */
  eyebrowAs?: 'h1' | 'p';
  /** Główna linia headline'u. */
  headline: ReactNode;
  /** Akcent-słowo headline'u — kanon: gold italic (patrz CSS). */
  headlineAccent?: ReactNode;
  lede?: ReactNode;
  /** Slot na buttony strony (logika CTA zostaje per-page). */
  actions?: ReactNode;
  /** Pill/linia reassurance pod akcjami (SLA, availability, proof). */
  meta?: ReactNode;
  /** Prawa kolumna: PhoneMockup / kolaż / foto. Bez media = jedna kolumna. */
  media?: ReactNode;
  /** id headline'u — sekcja dostaje aria-labelledby. */
  headingId?: string;
  /** Strona może dosypać własne tło/niuans. */
  className?: string;
  /** Sweep-shimmer na primary CTA (first-child). Off domyślnie — pomija
   *  outlined-only hero w /dev/ui (sweep ma sens tylko na solid primary). */
  shimmerCta?: boolean;
}

/**
 * LpHero — kanoniczny hero stron statycznych (LP).
 *
 * DECISION (nie usuwaj tego komentarza):
 * Kanon akcentu hero = GOLD ITALIC (var(--color-accent-fg) + font-style
 * italic + serif --font-heading w wadze 400). LpHero jest JEDYNYM wzorcem
 * hero LP — hero był skopiowany na 8 stronach i dryfował (compare: fioletowy
 * akcent, contact: zgubiony italic). Wizual i typografia żyją TUTAJ; strony
 * dostarczają wyłącznie treść (i18n) i logikę akcji. Nie buduj per-page
 * klas .hero* od zera — rozszerzaj przez className.
 */
export function LpHeroOrganism({
  eyebrow,
  eyebrowAs = 'p',
  headline,
  headlineAccent,
  lede,
  actions,
  meta,
  media,
  headingId,
  className,
  shimmerCta = false,
}: LpHeroProps) {
  // Eyebrow jako h1 (SEO) => headline wizualny to h2; inaczej headline = h1.
  const HeadlineTag = eyebrowAs === 'h1' ? 'h2' : 'h1';

  return (
    <section
      className={clsx(styles.hero, className)}
      aria-labelledby={headingId}
      data-has-media={media != null || undefined}>
      <div className={styles.inner}>
        <div className={styles.content}>
          {eyebrow != null && (
            <EyebrowAtom as={eyebrowAs} variant='chip'>
              {eyebrow}
            </EyebrowAtom>
          )}
          <HeadlineTag id={headingId} className={styles.headline}>
            {headline}
            {headlineAccent != null && (
              <>
                {' '}
                <span className={styles.headlineAccent}>{headlineAccent}</span>
              </>
            )}
          </HeadlineTag>
          {lede != null && <p className={styles.lede}>{lede}</p>}
          {actions != null && (
            <div
              className={styles.actions}
              data-cta-shimmer={shimmerCta ? 'on' : undefined}>
              {actions}
            </div>
          )}
          {meta != null && <div className={styles.meta}>{meta}</div>}
        </div>
        {media != null && <div className={styles.media}>{media}</div>}
      </div>
    </section>
  );
}
