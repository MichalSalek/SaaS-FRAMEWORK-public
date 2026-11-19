import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { useTranslations } from 'next-intl';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { FinalCtaBandOrganism } from '../../components/FinalCtaBand/FinalCtaBand.organism';

interface PricingFinalCtaProps {
  /** A stylist with an active plan sees „Zarządzaj planem", not „Zacznij". */
  hasPlan: boolean;
  onCtaClick: () => void;
}

/**
 * The final band of pricing. Split from the page composition, which hit the
 * 300-line limit; the band is a self-contained piece: it gets two things (whether the
 * user has a plan and what to do on click) and knows nothing more about the page.
 */
export function PricingFinalCtaOrganism({
  hasPlan,
  onCtaClick,
}: PricingFinalCtaProps) {
  const t = useTranslations('static.pricing');

  return (
    <FinalCtaBandOrganism
      headingId='pricing-final-cta'
      headlineLine1={t('finalCta.headlineLine1')}
      headlineAccent={t('finalCta.headlineAccent')}
      body={t('finalCta.body')}
      actions={
        <ButtonAtom
          direction='forward'
          variant='primary'
          size='lg'
          onClick={onCtaClick}>
          {hasPlan ? t('hero.ctaManage') : t('finalCta.cta')}
        </ButtonAtom>
      }
      secondary={
        /* The link draws the arrow (AppParagraphLinkAtom), the text does not carry it:
         * a text ending in „→" would show two.
         * Copy (×3 locales) says "Zajrzyj do FAQ", and the href matches the
         * anchor of the FAQ section. */
        <AppParagraphLinkAtom href='#pricing-faq'>
          {t('finalCta.secondary')}
        </AppParagraphLinkAtom>
      }
      footnote={t('finalCta.reassurance')}
    />
  );
}
