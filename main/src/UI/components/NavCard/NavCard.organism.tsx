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
   * internal: next/link (default, internal routes).
   * external: ExternalLinkAtom (Capacitor-safe in-app browser, e.g. Instagram).
   * plain: a bare <a> (mailto:/tel: or an anchor with an onClick tab switch).
   */
  linkType?: NavCardLinkType;
  /** Only for linkType='plain', e.g. scroll plus a tab switch. */
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  /** Icon (Phosphor) in a gold icon chip. */
  icon?: ReactNode;
  /** Kicker above the title (uppercase). */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** span when the whole card is a link (semantics: Contact/NotFound); h3 when
   *  the navigation card carries a list section heading. */
  titleAs?: 'h3' | 'span';
  body?: ReactNode;
  /** Footer, e.g. article count or channel value. */
  meta?: ReactNode;
  /** Arrow in the top-right corner (default true). */
  arrow?: boolean;
  /** aria-label when the link card has no readable text of its own. */
  ariaLabel?: string;
  className?: string;
}

/**
 * NavCard: the canonical TAPPABLE navigation card (icon chip + kicker + title
 * + body/meta + arrow; the whole card is a link). Replaced hand-rolled
 * .channelCard / .categoryCard / .useCase / NotFound .card.
 *
 * Interactive, so hover/focus is allowed (lift + border tint, floor §4: the card
 * IS a link). A static feature card (no href, no hover) is FeatureCard. Renders
 * next/link, ExternalLinkAtom or a bare <a> per linkType.
 *
 * Per-page tuning through var hooks on `className`:
 *   --nav-card-pad: padding
 *   --nav-card-bg: background (default bg-paper)
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
