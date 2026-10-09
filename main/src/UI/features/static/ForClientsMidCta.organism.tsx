import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  trackSignupStarted,
  withCtaTracking,
  withSignupTracking,
} from '../../../application/analytics/cta-events';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { InkPanelAtom } from '../../components/InkPanel/InkPanel.atom';
import { SectionComposition } from '../../components/Section/Section.composition';
import { useAppEntryMode } from '../../shared/hooks/useAppEntryMode';
import { useClientStartCta } from '../../shared/hooks/useClientStartCta';
import styles from './ForClientsPage.module.css';

/**
 * Środkowe CTA strony dla klientek. Wydzielone z ForClientsPageSections, bo ten
 * plik dobił do limitu 300 linii — a ta sekcja jest samodzielna: nie dzieli
 * stanu z sąsiadami, tylko własny hook „skąd zacząć" i pomiar kliknięcia.
 */
export function ForClientsMidCtaSectionOrganism() {
  const router = useRouter();
  const t = useTranslations('static.forClients');
  const mode = useAppEntryMode();
  // Device-aware „start" CTA klientki — parytet z hero/finalCta (owner 2026-07-18):
  // mobile web bez apki do pobrania (iOS zawsze; Android do premiery w Play —
  // web-first D0) → przeglądarka zamiast ślepego /get-app z wyłączonymi
  // store-buttonami. Desktop bez zmian (/get-app).
  const clientStart = useClientStartCta();

  return (
    /* Band = Section (bordered: para hairline 1:1 ze starym bandem);
       inner constrained przejął rolę skasowanej .midCtaPanel (lp+auto). */
    <SectionComposition bordered className={styles.midCta}>
      <InkPanelAtom tone='ink'>
        <div className={styles.midCtaGrid}>
          <div className={styles.midCtaLeft}>
            <p className={styles.midCtaQuote}>
              {t.rich('midCta.quote', {
                em: chunks => <em>{chunks}</em>,
              })}
            </p>
            <p className={styles.midCtaSubtext}>{t('midCta.text')}</p>
          </div>
          <div className={styles.midCtaRight}>
            <ButtonAtom
              direction='forward'
              variant='primary'
              size='lg'
              onClick={(clientStart.isBrowserStart
                ? withSignupTracking
                : withCtaTracking)(
                'clients-mid',
                () => void router.push(clientStart.href)
              )}>
              {clientStart.isBrowserStart
                ? t('webStartCta')
                : t('midCta.button')}
            </ButtonAtom>
            {mode === 'app' && (
              <AppParagraphLinkAtom
                onClick={() => trackSignupStarted('clients-mid')}
                href={`${ROUTES_FRONT.USER_LOG}?intent=register`}
                className={styles.midCtaWebLink}>
                {t('midCta.webLink')}
              </AppParagraphLinkAtom>
            )}
          </div>
        </div>
      </InkPanelAtom>
    </SectionComposition>
  );
}
