import { ButtonAtom } from '../../components/Button/Button.atom';
import { MidPageCtaMolecule } from '../../components/MidPageCta/MidPageCta.molecule';

interface HomeMidCtaProps {
  headline: string;
  accent: string;
  cta: string;
  onAction: () => void;
  reassurance?: string;
}

/**
 * Thin MidPageCtaMolecule wrapper for home: DRY for the 3 mid-CTAs placed every
 * second section. The button carries the shimmer effect through the molecule's
 * action slot.
 */
export function HomeMidCtaOrganism({
  headline,
  accent,
  cta,
  onAction,
  reassurance,
}: HomeMidCtaProps) {
  return (
    <MidPageCtaMolecule
      headline={headline}
      headlineAccent={accent}
      reassurance={reassurance}
      action={
        <ButtonAtom
          direction='forward'
          variant='primary'
          size='lg'
          onClick={onAction}>
          {cta}
        </ButtonAtom>
      }
    />
  );
}
