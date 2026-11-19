import { useRef, type ReactNode } from 'react';
import clsx from 'clsx';
import { EyebrowAtom } from '../Eyebrow/Eyebrow.atom';
import { useReportHeroVisibility } from './useReportHeroVisibility';
import styles from './AppHero.module.css';

export interface AppHeroProps {
  /** Screen heading. */
  title: ReactNode;
  /** Trailing title text; see the single-color heading decision in LpHero.module.css. */
  accent?: string;
  /** Inline title continuation; inherits the heading style, as does accent. */
  accentInline?: string;
  /**
   * Chip eyebrow above the title. On TOOL and funnel screens do NOT pass a tautological type
   * label. The prop stays for admin chrome and for exceptions that encode a state or filter.
   */
  eyebrow?: string;
  /** Introductory sentence under the title. */
  subtitle?: ReactNode;
  /**
   * Row of live metadata (sans, accent-fg), an alternative to a marketing subtitle: something
   * concrete instead of a promise („12 prac, ostatnia wczoraj"). Taste rule: concrete beats vague.
   */
  meta?: ReactNode;
  /**
   * Slot on the right (e.g. a profile avatar): the screen's identity element LIVES in the card,
   * not as an orphaned strip under it.
   */
  aside?: ReactNode;
  className?: string;
}

/**
 * The canonical intro of an app screen. Floor-compliant: zero gradients, no sparkles or stars
 * (owner).
 *
 * Density is set by the page through WHICH props it passes (eyebrow/subtitle/meta are optional).
 * Numbers in meta are always sans (Marcellus renders 0 like the letter O).
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
  /* Report the intro card's visibility to AppLayout so the top bar fades the duplicated title
   * (owner). The mechanism is shared with onboarding through useReportHeroVisibility (observer +
   * scroll root #main-content). */
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
          {accent ? <> {accent}</> : null}
          {accentInline ? <> {accentInline}</> : null}
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
