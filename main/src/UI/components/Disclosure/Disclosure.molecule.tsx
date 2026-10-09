// UI/components/Disclosure/Disclosure.molecule.tsx
// A secondary section folded to ONE line: a title, an optional short summary
// of its state (progress, a count) and a caret. Opens in place.
//
// DECISION (nie usuwaj tego komentarza) — owner 2026-10-08 („zwięźlej”):
// sections that are not the main action collapse instead of holding the fold.
// Promoted from the dashboard's own DashboardDisclosure when the salon team
// card, the sessions list and the client card had each built the same thing
// (S126). The body is DisclosurePanelAtom (one animation recipe, DECISION
// there). Not for FAQ lists (AccordionItemMolecule: one open at a time, its
// own typography) and not a replacement for a dialog.

import { useId, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { CaretDownIcon } from '@phosphor-icons/react';
import { DisclosurePanelAtom } from './DisclosurePanel.atom';
import styles from './Disclosure.module.css';

export interface DisclosureProps {
  title: ReactNode;
  /** One quiet line under the title (progress, a count). */
  summary?: ReactNode;
  /** Uncontrolled: the initial state. Ignored when `open` is passed. */
  defaultOpen?: boolean;
  /** Controlled state; pair it with `onOpenChange`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * `box` (default) — the disclosure IS a white box on paper (a section of a
   * page). `plain` — it sits inside a box that already exists (a card, a
   * dialog): no background, no inner padding.
   */
  surface?: 'box' | 'plain';
  /** Heading level of the summary row, from the page outline. */
  headingAs?: 'h2' | 'h3' | 'h4';
  children: ReactNode;
  /** Placement only (a margin, a grid area). */
  className?: string;
}

export function DisclosureMolecule({
  title,
  summary,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  surface = 'box',
  headingAs: Heading = 'h2',
  children,
  className,
}: DisclosureProps) {
  const [innerOpen, setInnerOpen] = useState(defaultOpen);
  const open = controlledOpen ?? innerOpen;
  const panelId = useId();
  const triggerId = useId();

  const toggle = () => {
    const next = !open;
    if (controlledOpen === undefined) {
      setInnerOpen(next);
    }
    onOpenChange?.(next);
  };

  return (
    <section className={clsx(styles.root, className)} data-surface={surface}>
      <Heading className={styles.heading}>
        <button
          id={triggerId}
          type='button'
          className={`${styles.trigger} haptic-press`}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}>
          <span className={styles.text}>
            <span className={styles.title}>{title}</span>
            {summary !== undefined && (
              <span className={styles.summary}>{summary}</span>
            )}
          </span>
          <CaretDownIcon
            size={18}
            className={styles.caret}
            data-open={open || undefined}
            aria-hidden='true'
          />
        </button>
      </Heading>
      <DisclosurePanelAtom id={panelId} open={open} labelledBy={triggerId}>
        {children}
      </DisclosurePanelAtom>
    </section>
  );
}
