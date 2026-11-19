import { useState, type ReactNode } from 'react';
import { CaretDownIcon } from '@phosphor-icons/react';
import mechanics from './Accordion.module.css';

/**
 * Shared FAQ accordion item: a single a11y-correct primitive.
 *
 * DECISION: replaces four near-identical page-local accordions (ForStylists, ForClients,
 * ForStudios, Pricing). CSS stays per page and is injected through the `classNames` slot object,
 * so the DOM is identical to the old copies. HelpCenterAccordion deliberately does NOT use this
 * primitive: it is coupled to search filtering, stagger (--stagger-index) and <Typography>, and
 * parameterizing that here would need conditional props. `idPrefix` keeps DOM ids unique per page.
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
  /** Per-page DOM id namespace, e.g. 'stylists-faq' -> 'stylists-faq-panel-0'. */
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
      {/* SEO + a11y (ARIA APG disclosure FAQ): the question is an <h3> wrapping the trigger
          button, so long FAQ phrases carry heading weight (crawler + screen-reader heading
          navigation). The FAQ section has its own <h2>, so questions are h3. .triggerHeading
          resets the h3 margin/font, so the button rules the look. */}
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
      {/* The panel is always in the DOM: grid-rows 0fr to 1fr animates the opening (Style Policy
          §5), and the visibility delay in Accordion.module.css removes the collapsed content from
          the tab order and a11y tree after the animation. The page skin (classNames.content)
          stays on the inner element. */}
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
