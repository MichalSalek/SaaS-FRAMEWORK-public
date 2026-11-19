// UI/components/Disclosure/DisclosurePanel.atom.tsx
// The animated body of a disclosure, without a trigger: content that is
// always mounted and opens in place.
//
// DECISION: the mechanism had six local copies that disagreed on what "closed" means (one hid by
// opacity only, so collapsed switches stayed in the tab order; two forgot `inert`). It is ONE
// recipe: grid-rows 0fr to 1fr over 200ms (never display:none to block; the height needs no
// measuring), `visibility` follows with a delay so the content shows at once on opening and leaves
// the accessibility tree only when the fold has finished, and `inert` takes it out of the tab
// order while closed. Use it directly when the trigger is a button of your own ("Pokaż pozostałe
// (N)", "Dodaj wizytę"): give that button `aria-expanded` and `aria-controls={id}`. A titled,
// collapsible section is DisclosureMolecule.

import type { ReactNode } from 'react';
import styles from './Disclosure.module.css';

export interface DisclosurePanelProps {
  /** Referenced by the trigger's `aria-controls`. */
  id: string;
  open: boolean;
  children: ReactNode;
  /** Names the panel as a region (the id of its trigger). */
  labelledBy?: string;
  /** Styles the CONTENT box (padding, gap), not the animated shell. */
  className?: string;
  /**
   * The fold exists only from this width up. Below it the panel does not
   * exist as a box at all (`display: contents`): its content is always shown
   * and laid out by the PARENT (a row that scrolls sideways on a phone).
   * The closed state is carried by CSS alone, so the server renders the whole
   * content and nothing jumps after hydration; `inert` is left out because
   * it cannot follow a media query, and `visibility: hidden` already takes a
   * closed panel out of the tab order and the accessibility tree.
   */
  from?: 'md';
}

export function DisclosurePanelAtom({
  id,
  open,
  children,
  labelledBy,
  className,
  from,
}: DisclosurePanelProps) {
  const contentClass = [styles.content, className].filter(Boolean).join(' ');
  return (
    <div
      className={styles.panel}
      data-open={open || undefined}
      data-from={from}
      inert={from === undefined ? !open : undefined}>
      <div className={styles.clip}>
        <div
          id={id}
          className={contentClass}
          {...(labelledBy !== undefined
            ? { role: 'region', 'aria-labelledby': labelledBy }
            : {})}>
          {children}
        </div>
      </div>
    </div>
  );
}
