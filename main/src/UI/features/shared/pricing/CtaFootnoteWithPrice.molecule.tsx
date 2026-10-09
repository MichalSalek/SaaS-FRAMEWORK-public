import type { ReactNode } from 'react';
import { EntryPriceNoteMolecule } from './EntryPriceNote.molecule';

interface CtaFootnoteWithPriceProps {
  /** Zdanie reassurance strony (i18n) — zostaje treścią strony, nie molekuły. */
  text: ReactNode;
}

/**
 * Stopka bandu finałowego: zdanie reassurance plus cena wejściowa.
 *
 * Istnieje, bo ten sam fragment powtarzał się na trzech stronach naraz, a slot
 * `footnote` renderuje się wewnątrz <p> — więc każde miejsce musiałoby osobno
 * pamiętać, żeby nie wstawić tam akapitu. Jedna molekuła, jedna zasada.
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
