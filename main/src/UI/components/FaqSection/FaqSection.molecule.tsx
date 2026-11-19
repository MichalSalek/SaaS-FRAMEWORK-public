import { useId, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  AccordionItemMolecule,
  type AccordionItemClassNames,
} from '../Accordion/AccordionItem.molecule';
import { SectionHeaderMolecule } from '../SectionHeader/SectionHeader.molecule';
import styles from './FaqSection.module.css';

interface FaqItem {
  id: string;
  question: ReactNode;
  answer: ReactNode;
  /** Opens the item by default (ForClients opens the first one). */
  defaultOpen?: boolean;
}

export interface FaqSectionProps {
  /** Rendered by <SectionHeader> as the <h2>. */
  title?: ReactNode;
  lede?: ReactNode;
  items: ReadonlyArray<FaqItem>;
  /** id of the <h2>; the section references it through aria-labelledby. */
  headingId?: string;
  /** DOM id namespace for the a11y trigger/panel (e.g. 'pricing-faq' gives
   *  'pricing-faq-panel-0'). Fallback: headingId, then a stable useId. */
  idPrefix?: string;
  className?: string;
  /** Escape hatch: per-page override of the accordion classes. */
  accordionClassNames?: Partial<AccordionItemClassNames>;
}

/**
 * FaqSection — the only FAQ pattern on the landing pages.
 *
 * DECISION: the canonical skin lives in FaqSection.module.css; pages carry no FAQ class
 * dictionaries of their own (per-page copies drifted in hover color and timing). Behavior:
 * multi-open, uncontrolled (each AccordionItem keeps its own state). The full-bleed band stays
 * with the page; expand mechanics stay shared in Accordion.module.css.
 */
export function FaqSectionMolecule({
  title,
  lede,
  items,
  headingId,
  idPrefix,
  className,
  accordionClassNames,
}: FaqSectionProps) {
  // Stable (SSR-safe) fallback namespace when the page passes none.
  const reactId = useId();
  const accordionIdPrefix = idPrefix ?? headingId ?? `faq-${reactId}`;

  // Per-key merge (not a spread): satisfies exactOptionalPropertyTypes and
  // makes explicit which slot the page overrides and which stays canonical.
  const accordionClasses: AccordionItemClassNames = {
    item: accordionClassNames?.item ?? styles.item,
    trigger: accordionClassNames?.trigger ?? styles.trigger,
    chevron: accordionClassNames?.chevron ?? styles.chevron,
    content: accordionClassNames?.content ?? styles.content,
    answer: accordionClassNames?.answer ?? styles.answer,
  };

  const hasHeader = title != null || lede != null;

  return (
    <section
      className={clsx(styles.section, className)}
      aria-labelledby={headingId}>
      {hasHeader && (
        <SectionHeaderMolecule
          title={title}
          className={styles.header}
          {...(headingId != null ? { titleId: headingId } : {})}>
          {lede}
        </SectionHeaderMolecule>
      )}
      <div className={styles.list}>
        {items.map((item, index) => (
          <AccordionItemMolecule
            key={item.id}
            idPrefix={accordionIdPrefix}
            index={index}
            question={item.question}
            answer={item.answer}
            defaultOpen={item.defaultOpen ?? false}
            classNames={accordionClasses}
          />
        ))}
      </div>
    </section>
  );
}
