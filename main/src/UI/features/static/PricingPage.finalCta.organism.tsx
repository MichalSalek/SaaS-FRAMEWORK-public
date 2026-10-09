import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { useTranslations } from 'next-intl';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { FinalCtaBandOrganism } from '../../components/FinalCtaBand/FinalCtaBand.organism';

interface PricingFinalCtaProps {
  /** Stylistka z aktywnym planem widzi „Zarządzaj planem", nie „Zacznij". */
  hasPlan: boolean;
  onCtaClick: () => void;
}

/**
 * Band finałowy cennika. Wydzielony z kompozycji strony, bo ta dobiła do limitu
 * 300 linii — a band jest samodzielnym kawałkiem: dostaje dwie rzeczy (czy
 * użytkowniczka ma plan i co zrobić po kliknięciu) i nie wie nic więcej o stronie.
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
        /* String i18n kończy się już "→" — bez ikony (dubel strzałek).
         * Copy (×3 locale) mówi "Zajrzyj do FAQ" — href wyrównany do
         * kotwicy sekcji FAQ (wcześniej mylnie /for-studios). */
        <AppParagraphLinkAtom href='#pricing-faq'>
          {t('finalCta.secondary')}
        </AppParagraphLinkAtom>
      }
      footnote={t('finalCta.reassurance')}
    />
  );
}
