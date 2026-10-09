// UI/components/Disclosure/DisclosurePanel.atom.tsx
// The animated body of a disclosure, without a trigger: content that is
// always mounted and opens in place.
//
// DECISION (nie usuwaj tego komentarza) — S126: the mechanism lived in six
// local copies that had drifted on what „closed” means (one hid by opacity
// only, so collapsed switches stayed in the tab order; two forgot `inert`).
// It is ONE recipe now: grid-rows 0fr → 1fr over 200ms (never display:none →
// block, the height needs no measuring), `visibility` follows with a delay so
// the content shows at once on opening and leaves the accessibility tree only
// when the fold has finished, and `inert` takes it out of the tab order while
// closed. Use it directly when the trigger is a button of your own („Pokaż
// pozostałe (N)”, „Dodaj wizytę”): give that button `aria-expanded` and
// `aria-controls={id}`. A titled, collapsible section is DisclosureMolecule.

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
}

export function DisclosurePanelAtom({
  id,
  open,
  children,
  labelledBy,
  className,
}: DisclosurePanelProps) {
  const contentClass = [styles.content, className].filter(Boolean).join(' ');
  return (
    <div className={styles.panel} data-open={open || undefined} inert={!open}>
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
