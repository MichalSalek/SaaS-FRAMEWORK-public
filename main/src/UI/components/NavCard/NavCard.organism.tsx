import type { ReactNode, MouseEventHandler } from 'react';
import { AppLinkAtom as Link } from '../AppLink/AppLink.atom';
import clsx from 'clsx';
import { ExternalLinkAtom } from '../ExternalLink/ExternalLink.atom';
import { EyebrowAtom } from '../Eyebrow/Eyebrow.atom';
import styles from './NavCard.module.css';
import { AffordanceDiscAtom } from '../AffordanceDisc/AffordanceDisc.atom';

type NavCardLinkType = 'internal' | 'external' | 'plain';

export interface NavCardProps {
  href: string;
  /**
   * internal — next/link (default, trasy wewnętrzne).
   * external — ExternalLinkAtom (Capacitor-safe in-app browser; np. Instagram).
   * plain    — goły <a> (mailto:/tel: lub anchor z onClick tab-switch).
   */
  linkType?: NavCardLinkType;
  /** Tylko dla linkType='plain' — np. scroll + przełączenie zakładki. */
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  /** Ikona (Phosphor) w gold icon-chipie. */
  icon?: ReactNode;
  /** Kicker nad tytułem (uppercase). */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** span gdy cała karta jest linkiem (semantyka — Contact/NotFound); h3 gdy
   *  karta nawigacyjna niesie nagłówek sekcji listy. */
  titleAs?: 'h3' | 'span';
  body?: ReactNode;
  /** Stopka — np. liczba artykułów / wartość kanału. */
  meta?: ReactNode;
  /** Strzałka w prawym-górnym rogu (default true). */
  arrow?: boolean;
  /** aria-label gdy karta-link nie ma czytelnego tekstu samodzielnie. */
  ariaLabel?: string;
  className?: string;
}

/**
 * NavCard — kanoniczna KLIKALNA karta nawigacyjna (icon-chip + kicker + tytuł
 * + body/meta + strzałka, cała karta jest linkiem). Zastąpiła hand-rolled
 * .channelCard / .categoryCard / .useCase / NotFound .card.
 *
 * Interaktywna → hover/focus dozwolony (lift + border tint, floor §4 — karta
 * JEST linkiem). Do statycznej karty cechy (bez href, zero hover) służy
 * FeatureCard. Renderuje next/link · ExternalLinkAtom · goły <a> wg linkType.
 *
 * Per-strona dostrojenie przez var-hooki na `className`:
 *   --nav-card-pad  → padding
 *   --nav-card-bg   → tło (domyślnie bg-paper)
 */
export function NavCardOrganism({
  href,
  linkType = 'internal',
  onClick,
  icon,
  eyebrow,
  title,
  titleAs: TitleTag = 'span',
  body,
  meta,
  arrow = true,
  ariaLabel,
  className,
}: NavCardProps) {
  const inner = (
    <>
      {icon != null && (
        <span className={styles.icon} aria-hidden='true'>
          {icon}
        </span>
      )}
      <span className={styles.content}>
        {eyebrow != null && (
          <EyebrowAtom variant='plain'>{eyebrow}</EyebrowAtom>
        )}
        <TitleTag className={styles.title}>{title}</TitleTag>
        {body != null && <span className={styles.body}>{body}</span>}
        {meta != null && <span className={styles.meta}>{meta}</span>}
      </span>
      {arrow && <AffordanceDiscAtom className={styles.arrow} />}
    </>
  );

  const cls = clsx(styles.card, className);

  if (linkType === 'external') {
    return (
      <ExternalLinkAtom href={href} className={cls} aria-label={ariaLabel}>
        {inner}
      </ExternalLinkAtom>
    );
  }
  if (linkType === 'plain') {
    return (
      <a href={href} onClick={onClick} className={cls} aria-label={ariaLabel}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className={cls} aria-label={ariaLabel}>
      {inner}
    </Link>
  );
}
