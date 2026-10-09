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
 * Cienki wrapper MidPageCtaMolecule dla home — DRY dla 3 mid-CTA „co drugą
 * sekcję" (S81). Button niesie efekt shimmer przez slot action molekuły.
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
