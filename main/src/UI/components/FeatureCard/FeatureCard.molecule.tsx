import type { ReactNode } from 'react';
import clsx from 'clsx';
import { EyebrowAtom } from '../Eyebrow/Eyebrow.atom';
import styles from './FeatureCard.module.css';

export interface FeatureCardProps {
  /**
   * Marker karty — ikona (Phosphor, renderowana w gold icon-chipie) LUB
   * numerał (np. NumberMarker). Pominięty = karta bez markera (icon-less,
   * wzorzec ForClients .benefit). Renderowany aria-hidden — znaczenie niesie
   * tytuł.
   */
  icon?: ReactNode;
  /** Kicker nad tytułem (kicker zdaniowy, role --style-kicker-*) — kategoria / meta / etap. */
  eyebrow?: ReactNode;
  title: ReactNode;
  titleAs?: 'h3' | 'h4';
  /** id <h3>, gdy sekcja spina aria-labelledby. */
  titleId?: string;
  body?: ReactNode;
  /** Stopka karty — dodatkowy szczegół pod body (np. detal, label). */
  meta?: ReactNode;
  className?: string;
}

/**
 * FeatureCard — kanoniczna STATYCZNA karta cechy/wartości (icon-chip + opcjonalny
 * kicker + h3 + body + opcjonalna meta-stopka). Zastąpiła hand-rolled
 * .value/.operatingItem/.playbookItem/.feature/.trustItem-y na stronach LP.
 *
 * Statyczna = NIE klikalna, ZERO hover (floor §4). Do karty będącej linkiem
 * (href + strzałka + hover) służy NavCard. Układaj w FeatureCardGrid.
 *
 * Per-strona dostrojenie przez var-hooki na `className`:
 *   --feature-card-pad        → padding
 *   --feature-card-bg         → tło (domyślnie bg-main; bg-paper na band)
 *   --feature-card-gap        → odstęp pionowy
 *   --feature-card-title-size → font-size tytułu
 *   --feature-card-border     → cała rama (domyślnie surface 2px divider)
 *   --feature-card-body-size  → font-size treści
 *   --feature-card-body-lh    → interlinia treści (domyślnie --leading-body)
 */
export function FeatureCardMolecule({
  icon,
  eyebrow,
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
      {eyebrow != null && <EyebrowAtom variant='plain'>{eyebrow}</EyebrowAtom>}
      <TitleTag id={titleId} className={styles.title}>
        {title}
      </TitleTag>
      {body != null && <p className={styles.body}>{body}</p>}
      {meta != null && <p className={styles.meta}>{meta}</p>}
    </article>
  );
}
