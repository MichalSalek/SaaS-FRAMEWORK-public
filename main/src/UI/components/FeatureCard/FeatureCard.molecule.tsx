import type { ReactNode } from 'react';
import clsx from 'clsx';
import styles from './FeatureCard.module.css';

export interface FeatureCardProps {
  /**
   * Card marker: an icon (Phosphor, rendered in the icon chip) OR a numeral
   * (e.g. NumberMarker). Omitted = a card without a marker. Rendered
   * aria-hidden; the title carries the meaning.
   */
  icon?: ReactNode;
  title: ReactNode;
  titleAs?: 'h3' | 'h4';
  /** id of the <h3> when the section wires aria-labelledby. */
  titleId?: string;
  body?: ReactNode;
  /** Card footer: an extra detail under the body (e.g. a detail, a label). */
  meta?: ReactNode;
  className?: string;
}

/**
 * FeatureCard — the canonical STATIC feature/value card (icon chip + h3 +
 * body + optional meta footer). Static = NOT clickable, ZERO hover (floor §4);
 * a card that is a link uses NavCard. Lay out in FeatureCardGrid.
 *
 * Per-page tuning through var hooks on `className`: --feature-card-pad,
 * --feature-card-bg (default bg-main), --feature-card-gap,
 * --feature-card-title-size, --feature-card-border (whole frame),
 * --feature-card-body-size, --feature-card-body-lh (default --leading-body).
 */
export function FeatureCardMolecule({
  icon,
  title,
  titleAs: TitleTag = 'h3',
  titleId,
  body,
  meta,
  className,
}: FeatureCardProps) {
  return (
    <article className={clsx(styles.card, className)}>
      {icon != null && (
        <span className={styles.icon} aria-hidden='true'>
          {icon}
        </span>
      )}
      <TitleTag id={titleId} className={styles.title}>
        {title}
      </TitleTag>
      {body != null && <p className={styles.body}>{body}</p>}
      {meta != null && <p className={styles.meta}>{meta}</p>}
    </article>
  );
}
