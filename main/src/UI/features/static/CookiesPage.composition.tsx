import { useEffect, useState } from 'react';
import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { useTranslations } from 'next-intl';
import { HandPalmIcon, ShieldCheckIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { useCookieConsentStore } from '../../../application/stores/cookieConsent.store';
import { useAuth } from '../../contexts/AuthContext.composition';
import {
  LegalCalloutMolecule,
  LegalDocLayoutComposition,
  legalDocStyles as styles,
  type LegalDocTocItem,
} from './LegalDocLayout.composition';
import { CookiesBucketsOrganism } from './CookiesPageSections.organism';

/* ─── TOC item ids (stable, not translated, must match section ids in CookiesBuckets) ─── */
const TOC_ITEM_IDS = [
  'czym-sa-cookies',
  'cookies-niezbedne',
  'cookies-analityczne',
  'cookies-marketingowe',
  'zarzadzanie-cookies',
  'twoja-zgoda',
] as const;

const TOC_KEY_MAP: Record<(typeof TOC_ITEM_IDS)[number], string> = {
  'czym-sa-cookies': 'toc.item1',
  'cookies-niezbedne': 'toc.item2',
  'cookies-analityczne': 'toc.item3',
  'cookies-marketingowe': 'toc.item4',
  'zarzadzanie-cookies': 'toc.item5',
  'twoja-zgoda': 'toc.item6',
};

/* ─── CookiesPage ─── */
export function CookiesPageComposition() {
  const t = useTranslations('static.cookies');
  const tLegal = useTranslations('static.legal');
  const resetConsent = useCookieConsentStore(state => state.resetConsent);
  const consent = useCookieConsentStore(state => state.consent);
  const { isLoggedIn } = useAuth();
  // DECISION (nie usuwaj tego komentarza):
  // Hydration + GDPR Art. 7(3) withdraw guard.
  // — `mounted` chroni przed SSR/CSR mismatch (`isLoggedIn` derived z
  //    localStorage bearer token, SSR=false / CSR=true).
  // — Button "Zmień preferencje" widoczny gdy: pre-mount LUB niezalogowany
  //    LUB `consent !== null` (user dał już zgodę — musi móc wycofać,
  //    "withdraw must be as easy as giving"; może wynikać z sesji przed login).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const toc: LegalDocTocItem[] = TOC_ITEM_IDS.map(id => ({
    id,
    label: t(TOC_KEY_MAP[id]),
  }));

  return (
    <PublicLayoutComposition>
      <LegalDocLayoutComposition
        eyebrow={tLegal('eyebrow.cookies')}
        title={t('heading')}
        titleAccent={tLegal('titleAccent.cookies')}
        lede={tLegal('lede.cookies')}
        lastUpdatedLabel={t('lastUpdated')}
        tocHeading={t('toc.heading')}
        tocAriaLabel={t('toc.ariaLabel')}
        toc={toc}
        footerLastUpdatedLabel={tLegal('footer.lastUpdatedLabel')}
        footerLastUpdatedValue={t('lastUpdated')}
        printLabel={tLegal('footer.printLabel')}
        contactLabel={tLegal('footer.contactLabel')}
        backToTopLabel={tLegal('backToTop')}
        finalCta={{
          eyebrow: tLegal('sectionMarker.ctaCookies'),
          headlineLine1: t('cta.heading'),
          body: t('cta.body'),
          primaryLabel: t('cta.primaryBtn'),
          primaryHref: ROUTES_FRONT.CONTACT,
          secondaryLabel: t('cta.secondaryBtn'),
          secondaryHref: ROUTES_FRONT.PRIVACY,
        }}>
        <CookiesBucketsOrganism />
        {/* Withdraw consent CTA — GDPR Art. 7(3) compliant */}
        {!mounted || !isLoggedIn || consent !== null ? (
          <LegalCalloutMolecule
            icon={<HandPalmIcon size={14} weight='regular' />}>
            <strong
              className={styles.calloutText}
              style={{ display: 'block', marginBottom: 6 }}>
              {tLegal('cookies.withdrawCalloutTitle')}
            </strong>
            {tLegal('cookies.withdrawCalloutBody')}{' '}
            <ButtonAtom variant='text' size='sm' onClick={resetConsent}>
              {t('cta.changePrefsBtn')}
            </ButtonAtom>
          </LegalCalloutMolecule>
        ) : (
          <LegalCalloutMolecule
            icon={<ShieldCheckIcon size={14} weight='regular' />}>
            <strong
              className={styles.calloutText}
              style={{ display: 'block', marginBottom: 6 }}>
              {tLegal('cookies.loggedInCalloutTitle')}
            </strong>
            {tLegal('cookies.loggedInCalloutBody')}{' '}
            <AppParagraphLinkAtom
              href={ROUTES_FRONT.CONTACT}
              className={styles.tocLinkText}
              style={{
                color: 'var(--color-primary)',
                textDecoration: 'underline',
                textUnderlineOffset: 2,
              }}>
              {tLegal('cookies.loggedInCalloutLink')}
            </AppParagraphLinkAtom>
            .
          </LegalCalloutMolecule>
        )}
      </LegalDocLayoutComposition>
    </PublicLayoutComposition>
  );
}
