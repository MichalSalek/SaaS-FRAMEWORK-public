import { AppLinkAtom as Link } from '../../components/AppLink/AppLink.atom';
import { useTranslations } from 'next-intl';
import { ArrowRightIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  trackCtaClick,
  withSignupTracking,
} from '../../../application/analytics/cta-events';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { EyebrowAtom } from '../../components/Eyebrow/Eyebrow.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { useFreeSignupCta } from '../../shared/hooks/usePricingFunnelState';
import { EntryPriceNoteMolecule } from '../shared/pricing/EntryPriceNote.molecule';
import styles from './BlogPostCta.module.css';

/**
 * Domknięcie wpisu na blogu.
 *
 * Do tej pory artykuł kończył się linkiem „wróć do bloga" i kafelkami kolejnych
 * wpisów — czytelniczka, która właśnie przeczytała tekst o prowadzeniu klientek,
 * nie miała ani jednego miejsca, żeby przejść do produktu. Blog był domknięty
 * sam w sobie: wchodziło się z wyszukiwarki i wychodziło do wyszukiwarki.
 *
 * Cena stoi tu wprost, bo pytanie „ile to kosztuje" pada zaraz po „co to jest",
 * a odesłanie po nią do osobnej zakładki gubi połowę zainteresowanych.
 */
export function BlogPostCtaOrganism() {
  const t = useTranslations('blog.postCta');
  const goToSignup = useFreeSignupCta(
    `${ROUTES_FRONT.USER_LOG}?intent=register&role=stylist`
  );

  return (
    <section className={styles.cta} aria-labelledby='blog-post-cta-heading'>
      <EyebrowAtom variant='chip'>{t('eyebrow')}</EyebrowAtom>
      <TypographyAtom
        variant='h3'
        id='blog-post-cta-heading'
        className={styles.title}>
        {t('title')}
      </TypographyAtom>
      <p className={styles.lede}>{t('lede')}</p>

      <div className={styles.actions} data-cta-shimmer='on'>
        <ButtonAtom
          direction='forward'
          variant='primary'
          size='md'
          onClick={withSignupTracking('blog-after-post', goToSignup)}>
          {t('cta')}
        </ButtonAtom>
        <Link
          href={ROUTES_FRONT.PRICING}
          className={styles.secondary}
          onClick={() => trackCtaClick('blog-after-post')}>
          {t('secondary')}
          <ArrowRightIcon size={14} weight='regular' aria-hidden='true' />
        </Link>
      </div>

      <EntryPriceNoteMolecule />
    </section>
  );
}
