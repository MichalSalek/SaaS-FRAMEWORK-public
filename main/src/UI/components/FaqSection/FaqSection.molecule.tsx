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
  /** Parytet migracyjny: ForClients otwiera pierwszą kartę domyślnie. */
  defaultOpen?: boolean;
}

export interface FaqSectionProps {
  eyebrow?: ReactNode;
  /** Renderowany przez <SectionHeader> (kanoniczny stack eyebrow+h2+lede). */
  title?: ReactNode;
  lede?: ReactNode;
  items: ReadonlyArray<FaqItem>;
  /** id nagłówka <h2>; sekcja wiąże się z nim przez aria-labelledby. */
  headingId?: string;
  /** Namespace DOM id dla a11y trigger/panel (np. 'pricing-faq' →
   *  'pricing-faq-panel-0'). Fallback: headingId → stabilny useId. */
  idPrefix?: string;
  className?: string;
  /** Escape hatch na czas migracji: nadpisanie klas accordion per strona. */
  accordionClassNames?: Partial<AccordionItemClassNames>;
}

/**
 * FaqSection — jedyny wzorzec FAQ na LP.
 *
 * DECISION (nie usuwaj tego komentarza):
 * FaqSection = jedyny wzorzec FAQ na LP; skórka kanoniczna żyje TU
 * (FaqSection.module.css), strony przestają nosić własne słowniki klas
 * FAQ_ACCORDION_CLASSES (przed konsolidacją: 9 niemal identycznych kopii —
 * home/get-app/for-clients/for-stylists/for-studios/compare/contact/about/
 * pricing, każda z własnym dryfem hover-koloru i timingu).
 * Zachowanie = dominujące na wszystkich stronach: multi-open, uncontrolled
 * (każdy AccordionItem trzyma własny stan — brak koordynacji single-open).
 * Sekcja siedzi w kontenerze rodzica — full-bleed band (100vw breakout,
 * tło, --section-block padding) zostaje po stronie strony.
 * Mechanika rozwijania (grid-rows 0fr→1fr, 250ms) pozostaje współdzielona
 * w Accordion.module.css; tu żyje wyłącznie skórka + szkielet sekcji.
 */
export function FaqSectionMolecule({
  eyebrow,
  title,
  lede,
  items,
  headingId,
  idPrefix,
  className,
  accordionClassNames,
}: FaqSectionProps) {
  // Stabilny (SSR-safe) fallback namespace, gdy strona nie poda własnego.
  const reactId = useId();
  const accordionIdPrefix = idPrefix ?? headingId ?? `faq-${reactId}`;

  // Merge per-klucz (nie spread): exactOptionalPropertyTypes + jawność,
  // który slot jest nadpisany przez stronę, a który kanoniczny.
  const accordionClasses: AccordionItemClassNames = {
    item: accordionClassNames?.item ?? styles.item,
    trigger: accordionClassNames?.trigger ?? styles.trigger,
    chevron: accordionClassNames?.chevron ?? styles.chevron,
    content: accordionClassNames?.content ?? styles.content,
    answer: accordionClassNames?.answer ?? styles.answer,
  };

  const hasHeader = eyebrow != null || title != null || lede != null;

  return (
    <section
      className={clsx(styles.section, className)}
      aria-labelledby={headingId}>
      {hasHeader && (
        <SectionHeaderMolecule
          eyebrow={eyebrow}
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
