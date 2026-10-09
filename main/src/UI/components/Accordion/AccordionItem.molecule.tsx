import { useState, type ReactNode } from 'react';
import { CaretDownIcon } from '@phosphor-icons/react';
import mechanics from './Accordion.module.css';

/**
 * Shared FAQ accordion item — single a11y-correct primitive.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Zastepuje 4 niemal identyczne lokalne kopie akordeonu (ForStylists, ForClients,
 * ForStudios, Pricing) — jeden bug a11y = jedna naprawa (B13/RULE OF THREE).
 * CSS jest per-strona (rozne palety/spacing), wiec klasy wstrzykiwane przez prop
 * `classNames` (slot-obiekt ze `styles.*` strony) — DOM jest byte-identyczny z
 * poprzednimi kopiami, zero regresji wizualnej. HelpCenterAccordion CELOWO NIE
 * uzywa tego prymitywu: jest sprzezony z search-filter, stagger (--stagger-index)
 * i <Typography>, a parametryzacja tego tutaj wymusilaby warunkowe propsy psujace
 * czytelnosc. idPrefix zachowuje unikalnosc DOM id per strona (a11y).
 */
export interface AccordionItemClassNames {
  item: string;
  trigger: string;
  chevron: string;
  content: string;
  answer: string;
}

interface AccordionItemProps {
  question: ReactNode;
  answer: ReactNode;
  /** Per-page DOM id namespace, np. 'stylists-faq' -> 'stylists-faq-panel-0'. */
  idPrefix: string;
  index: number;
  defaultOpen?: boolean;
  classNames: AccordionItemClassNames;
}

export function AccordionItemMolecule({
  question,
  answer,
  idPrefix,
  index,
  defaultOpen = false,
  classNames,
}: AccordionItemProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const panelId = `${idPrefix}-panel-${index}`;
  const triggerId = `${idPrefix}-trigger-${index}`;

  return (
    <div className={classNames.item} data-open={isOpen || undefined}>
      {/* SEO + a11y (ARIA APG disclosure-FAQ): pytanie = nagłówek <h3>
          opakowujący trigger-button, żeby długie frazy FAQ niosły wagę
          nagłówkową (crawler + nawigacja SR po nagłówkach). Sekcja FAQ ma
          własny <h2>, więc pytania to h3. .triggerHeading zeruje margines/font
          h3 → zero regresji wizualnej (button rządzi wyglądem). */}
      <h3 className={mechanics.triggerHeading}>
        <button
          id={triggerId}
          type='button'
          className={classNames.trigger}
          onClick={() => setIsOpen(prev => !prev)}
          aria-expanded={isOpen}
          aria-controls={panelId}>
          <span>{question}</span>
          <CaretDownIcon
            size={18}
            className={classNames.chevron}
            data-open={isOpen || undefined}
            aria-hidden='true'
          />
        </button>
      </h3>
      {/* Panel zawsze w DOM: grid-rows 0fr→1fr animuje otwarcie (Style
          Policy §5), a visibility-delay w Accordion.module.css zdejmuje
          zwiniętą treść z tab-orderu/a11y-tree po animacji. Skórka strony
          (classNames.content) zostaje na wewnętrznym elemencie. */}
      <div className={mechanics.panel} data-open={isOpen || undefined}>
        <div className={mechanics.panelClip}>
          <div
            id={panelId}
            role='region'
            aria-labelledby={triggerId}
            className={classNames.content}>
            <p className={classNames.answer}>{answer}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
