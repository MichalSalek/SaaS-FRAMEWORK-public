// UI/components/EmptyState/EmptyState.atom.tsx
// Canonical "nothing here yet" surface — medallion + heading + body + optional
// extras + optional CTA. Sibling of ErrorStateMolecule: that one is for a query
// that FAILED, this one for a query that succeeded and returned nothing.
//
// WHY it exists: 22 hand-rolled copies of the same recipe had drifted apart on
// every axis that was never measured — medallion 56/60/64/72/88/96/120px, gap
// 12/14/20, padding in five shapes, title fluid-lg/xl/lg, body base/sm, dashed
// border tinted 20/22/24/28/32%. Explore and Favorites were byte-identical
// except for a tip-chip that had silently split into two different tints.
//
// ATOM, not molecule: zero `components/*` imports (heading tag + CTA arrive as
// props/slots), which is the binding rule in ATOMIC_LAYERS.md — same call as
// StatusPill/PlanBadge.

import type { CSSProperties, ReactNode } from 'react';
import clsx from 'clsx';
import styles from './EmptyState.module.css';

export type EmptyStateSize = 'page' | 'panel';

export interface EmptyStateProps {
  /**
   * `page` — the whole view is empty (96px medallion, fluid heading).
   * `panel` — a section, table, dialog or column inside a populated view
   * (64px medallion, static heading). Defaults to `panel`, the common case.
   */
  size?: EmptyStateSize;
  /** Phosphor icon (or any node) inside the medallion. Omit for a text-only state. */
  icon?: ReactNode;
  /** Replaces the whole medallion — use for decorated illustrations. */
  illustration?: ReactNode;
  /**
   * Idle motion on the medallion. `float` (5s, −4px) is the calm default for
   * "waiting for content"; `pulse` (2.4s, 1.08×) reads as a heartbeat and is
   * reserved for states about affection/liveness. Both existed as one-off
   * keyframes on two pages before this component; they live here so a third
   * page cannot invent a third timing.
   */
  animate?: 'float' | 'pulse';
  title?: ReactNode;
  /**
   * Heading tag. Pick it from the page outline, do not leave it to chance:
   * `h1` when the empty state is the page's ONLY content (no hero, no other
   * heading: the page still needs its one h1), `h2` when the empty state stands for a whole view, `h3` inside a section
   * that already has a heading, `p` inside a dialog that has its own title.
   */
  titleAs?: 'h1' | 'h2' | 'h3' | 'h4' | 'p';
  description?: ReactNode;
  /** Extras between the description and the CTA — tip chips, steps, hints. */
  children?: ReactNode;
  /** Primary call to action. */
  action?: ReactNode;
  /**
   * Local overrides. Set ONLY custom properties (`--empty-*`) here — a plain
   * declaration of the same property from a page module has equal specificity
   * to this module's, so the winner is bundle order, not intent.
   */
  className?: string;
  /** Language of the copy — drives `hyphens: auto` for Polish. */
  lang?: string;
  /**
   * ARIA role for the container. `status` when the empty state REPLACES content
   * that was loading, so a screen reader announces the outcome instead of
   * leaving the user waiting on silence; `alert` when the same card shape is
   * carrying a failure the user has to act on.
   */
  role?: 'status' | 'alert';
  style?: CSSProperties;
}

export function EmptyStateAtom({
  size = 'panel',
  icon,
  illustration,
  animate,
  title,
  titleAs = 'h3',
  description,
  children,
  action,
  className,
  lang,
  role,
  style,
}: EmptyStateProps) {
  const Title = titleAs;
  const medallion =
    illustration ??
    (icon !== undefined ? (
      <span
        className={styles.medallion}
        data-animate={animate}
        aria-hidden='true'>
        {icon}
      </span>
    ) : null);

  return (
    <div
      className={clsx(styles.root, className)}
      data-size={size}
      {...(role !== undefined ? { role } : {})}
      style={style}>
      {medallion}
      {title !== undefined ? (
        <Title className={styles.title}>{title}</Title>
      ) : null}
      {description !== undefined ? (
        <p className={styles.description} lang={lang}>
          {description}
        </p>
      ) : null}
      {children}
      {action !== undefined ? (
        <div className={styles.action}>{action}</div>
      ) : null}
    </div>
  );
}
