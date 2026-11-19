import type { ReactNode } from 'react';
import styles from './MidPageCta.module.css';

export interface MidPageCtaProps {
  /** One-line headline: a natural continuation of the section ABOVE it (not a hero repeat). */
  headline: ReactNode;
  /** Trailing headline text with the same style as the whole heading. */
  headlineAccent?: ReactNode;
  /** Primary action slot: the page renders its own Button/Link (funnel logic
   *  stays per page). Wrapped in data-cta-shimmer='on' (the „living CTA” effect). */
  action: ReactNode;
  /** Quiet reassurance line under the action (SLA, „bez karty”, proof). */
  reassurance?: ReactNode;
  className?: string;
}

/**
 * MidPageCta: a light, centred CTA block placed BETWEEN LP sections (every other
 * section, owner) so a skimmer has an anchored button in the dead middle of the
 * page. NOT a full-bleed band (that is FinalCtaBand's role): a quiet section
 * close with whitespace and a top hairline. The headline matches the section
 * above; the primary CTA carries the shimmer.
 */
export function MidPageCtaMolecule({
  headline,
  headlineAccent,
  action,
  reassurance,
  className,
}: MidPageCtaProps) {
  return (
    <section className={`${styles.midCta} ${className ?? ''}`}>
      <div className={styles.inner}>
        <p className={styles.headline}>
          {headline}
          {headlineAccent != null && <> {headlineAccent}</>}
        </p>
        <div className={styles.actions} data-cta-shimmer='on'>
          {action}
        </div>
        {reassurance != null && (
          <p className={styles.reassurance}>{reassurance}</p>
        )}
      </div>
    </section>
  );
}
