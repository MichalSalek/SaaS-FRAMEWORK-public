import type { ReactNode } from 'react';
import { EntryPriceNoteMolecule } from './EntryPriceNote.molecule';

interface CtaFootnoteWithPriceProps {
  /** The page's reassurance sentence (i18n): stays page content, not molecule content. */
  text: ReactNode;
}

/**
 * Footer of the final band: the page's reassurance sentence plus the entry price.
 *
 * It exists because the same fragment repeated on three pages at once, and the
 * `footnote` slot renders inside a <p>, so every place would have had to remember
 * separately not to insert a paragraph there. One molecule, one rule.
 */
export function CtaFootnoteWithPriceMolecule({
  text,
}: CtaFootnoteWithPriceProps) {
  return (
    <>
      {text}
      <EntryPriceNoteMolecule withYearly />
    </>
  );
}
