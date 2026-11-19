import { KeepTogetherTextAtom } from '../KeepTogetherText/KeepTogetherText.atom';
import type { ReactNode } from 'react';
import styles from './FinalCtaBand.module.css';

export interface FinalCtaBandProps {
  /**
   * Owner vote: 'gold' (accent) on CONVERSION pages (pricing, compare,
   * get-app), 'ink' on INFORMATIONAL pages (about, contact, for-clients,
   * for-stylists, for-studios). The finale's tone carries the page's role.
   */
  tone?: 'gold' | 'ink';
  /** Headline line 1, rendered in the tone's text color (owner vote). */
  headlineLine1: ReactNode;
  /** Optional second line; inherits the heading foreground and typography. */
  headlineAccent?: ReactNode;
  body?: ReactNode;
  /** Primary action slot: the page renders its own Button/Link (plan-aware
   *  and mode-aware logic stays per page); the component styles the label. */
  actions: ReactNode;
  /** A bare <Link>/<a>; the component styles it as an underlined link on the band. */
  secondary?: ReactNode;
  /** Reassurance line under the actions. */
  footnote?: ReactNode;
  /** Page-specific decor (e.g. the for-clients photo frame), positioned in
   *  the page's CSS and rendered under the pattern. */
  decor?: ReactNode;
  headingId?: string;
  className?: string;
}

/**
 * FinalCtaBand — the only full-band final CTA pattern. Visuals and the color
 * canon live HERE; pages supply only content (i18n) and action logic. Two
 * tones: gold = a decision page, ink = a calm close of an informational page.
 */
export function FinalCtaBandOrganism({
  tone = 'gold',
  headlineLine1,
  headlineAccent,
  body,
  actions,
  secondary,
  footnote,
  decor,
  headingId,
  className,
}: FinalCtaBandProps) {
  return (
    <section
      className={`${styles.band} ${tone === 'ink' ? styles.bandInk : ''} ${className ?? ''}`}
      aria-labelledby={headingId}>
      {decor}
      <div className={styles.pattern} aria-hidden='true' />
      <div className={styles.inner}>
        <h2 id={headingId} className={styles.headline}>
          {headlineLine1}
          {headlineAccent != null && (
            <>
              <br />
              {headlineAccent}
            </>
          )}
        </h2>
        {body != null && (
          <p className={styles.body}>
            {}
            {typeof body === 'string' ? (
              <KeepTogetherTextAtom>{body}</KeepTogetherTextAtom>
            ) : (
              body
            )}
          </p>
        )}
        {/* data-cta-shimmer='on': slow sweep on the primary CTA (global.css) */}
        <div className={styles.actions} data-cta-shimmer='on'>
          {actions}
          {secondary != null && (
            <span className={styles.secondaryWrap}>{secondary}</span>
          )}
        </div>
        {footnote != null && <p className={styles.footnote}>{footnote}</p>}
      </div>
    </section>
  );
}
