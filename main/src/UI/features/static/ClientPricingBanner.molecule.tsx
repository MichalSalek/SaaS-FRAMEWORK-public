import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { useTranslations } from 'next-intl';
import { HeartIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import styles from './PricingPage.module.css';

/**
 * Client-banner „Jesteś klientką?" — biała karta + medalion serca (głos S77 = B:
 * chłodne czyste domknięcie, nie ciepły tint/przycisk). Owner S81: renderowany
 * bezpośrednio POD boxem Scale (slot `afterScale` PricingTierSection), domyka
 * ścieżkę planów nudgeem dla klientek. Odstęp górny niesie `.clientStripWrap`
 * (rytm równy Scale nad tabelą). Wydzielony z PricingPage.composition (max-lines).
 */
export function ClientPricingBannerMolecule() {
  const t = useTranslations('static.pricing');
  return (
    <div className={styles.clientStripWrap}>
      <div className={styles.clientBanner}>
        <span className={styles.clientBannerMedallion} aria-hidden='true'>
          <HeartIcon size={18} weight='fill' />
        </span>
        <p className={styles.clientBannerText}>
          <strong className={styles.clientBannerStrong}>
            {t('clientBanner.title')}
          </strong>{' '}
          {t('clientBanner.body')}
        </p>
        <AppParagraphLinkAtom
          href={ROUTES_FRONT.FOR_CLIENTS}
          className={styles.clientBannerLink}>
          {t('clientBanner.cta')}
        </AppParagraphLinkAtom>
      </div>
    </div>
  );
}
