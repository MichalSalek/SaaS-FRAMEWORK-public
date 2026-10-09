import { Fragment, type ReactNode } from 'react';
import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import {
  LegalParagraphAtom,
  LegalSectionMolecule,
  legalDocStyles as styles,
} from './LegalDocLayout.composition';
import sectionStyles from './CookiesPage.module.css';

/* ─── Void-tag renderer ───
 * DECISION (nie usuwaj tego komentarza):
 * Wartości i18n `sections.consent.body1/body2` używają SAMOZAMYKAJĄCYCH
 * placeholderów (`<cookieName/>`, `<email/>`, `<privacyLink/>`), których
 * treść w całości dostarcza kod. Parser ICU next-intl (formatjs) traktuje
 * samozamykające tagi jako LITERALNY tekst — `t.rich()` NIGDY nie wywołuje
 * dla nich handlerów (zweryfikowane na next-intl 4.11.1: działa wyłącznie
 * parowane `<tag></tag>`). Dlatego renderujemy je sami: surowa wiadomość →
 * split na `<nazwa/>` → podstawienie ReactNode z mapy. NIE przepisywać
 * z powrotem na `t.rich()` bez zmiany wartości i18n na tagi parowane. */
const VOID_TAG_SPLIT = /<(\w+)\s*\/>/;

function renderVoidTags(
  message: string,
  nodes: Record<string, ReactNode>
): ReactNode {
  /* split z capture group: nazwy tagów lądują na nieparzystych indeksach. */
  return message
    .split(VOID_TAG_SPLIT)
    .map((part, index) =>
      index % 2 === 1 ? (
        <Fragment key={index}>{nodes[part] ?? `<${part}/>`}</Fragment>
      ) : (
        part
      )
    );
}

/* ─── Cookie table row ─── */
interface CookieRow {
  name: string;
  purposeKey: string;
  durationKey: string;
}

interface CookieBucketProps {
  id: string;
  kicker: string;
  headingKey: string;
  descriptionKey: string;
  cookies: CookieRow[];
}

function CookieBucket({
  id,
  kicker,
  headingKey,
  descriptionKey,
  cookies,
}: CookieBucketProps) {
  const t = useTranslations('static.cookies');
  const title = t(headingKey);
  return (
    <LegalSectionMolecule id={id} kicker={kicker} title={title}>
      <LegalParagraphAtom>{t(descriptionKey)}</LegalParagraphAtom>
      <div
        className={sectionStyles.tableWrapper}
        role='region'
        aria-label={t('sections.essential.tableAriaLabel', { title })}>
        <table className={sectionStyles.table}>
          <thead>
            <tr>
              <th className={sectionStyles.th} scope='col'>
                {t('table.colName')}
              </th>
              <th className={sectionStyles.th} scope='col'>
                {t('table.colPurpose')}
              </th>
              <th className={sectionStyles.th} scope='col'>
                {t('table.colDuration')}
              </th>
            </tr>
          </thead>
          <tbody>
            {cookies.map(row => (
              <tr key={row.name} className={sectionStyles.tr}>
                {/* data-label = źródło etykiet kolumn dla mobilnego stacka
                    (<768px, CookiesPage.module.css .td::before) — i18n 1:1
                    z nagłówkami thead. */}
                <td
                  className={sectionStyles.td}
                  data-label={t('table.colName')}>
                  <code className={sectionStyles.cookieName}>{row.name}</code>
                </td>
                <td
                  className={sectionStyles.td}
                  data-label={t('table.colPurpose')}>
                  {t(row.purposeKey)}
                </td>
                <td
                  className={sectionStyles.td}
                  data-label={t('table.colDuration')}>
                  {t(row.durationKey)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LegalSectionMolecule>
  );
}

/* ─── Browser names (not localised — proper nouns) ─── */
const BROWSER_NAMES = ['chrome', 'firefox', 'safari', 'edge'] as const;

function BrowserInstructions() {
  const t = useTranslations('static.cookies');
  return (
    <ul className={sectionStyles.browserList}>
      {BROWSER_NAMES.map(b => (
        <li key={b} className={sectionStyles.browserItem}>
          <span className={sectionStyles.browserName}>
            {b.charAt(0).toUpperCase() + b.slice(1)}:
          </span>
          <span className={sectionStyles.browserSteps}>
            {t(`sections.managing.browsers.${b}`)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ─── Essential cookie rows ─── */
const ESSENTIAL_COOKIE_ROWS: CookieRow[] = [
  {
    name: 'authorization (localStorage)',
    purposeKey: 'sections.essential.cookies.authToken.purpose',
    durationKey: 'sections.essential.cookies.authToken.duration',
  },
  {
    // Faktyczny klucz zapisu zgody = zustand persist `name` w
    // cookieConsent.store.ts — NIE nazwa pliku stora.
    name: 'cookie-consent-v1 (localStorage)',
    purposeKey: 'sections.essential.cookies.consentStore.purpose',
    durationKey: 'sections.essential.cookies.consentStore.duration',
  },
];

/* ─── CookiesBuckets — all content sections, in TOC order ─── */
export function CookiesBucketsOrganism() {
  const t = useTranslations('static.cookies');
  const tLegal = useTranslations('static.legal');

  return (
    <>
      {/* 1. What are cookies */}
      <LegalSectionMolecule
        id='czym-sa-cookies'
        kicker={tLegal('cookies.kicker.intro')}
        title={t('sections.whatAreCookies.heading')}>
        <LegalParagraphAtom>
          {t('sections.whatAreCookies.body')}
        </LegalParagraphAtom>
      </LegalSectionMolecule>

      {/* 2. Essential cookies */}
      <CookieBucket
        id='cookies-niezbedne'
        kicker={tLegal('cookies.kicker.essential')}
        headingKey='sections.essential.heading'
        descriptionKey='sections.essential.description'
        cookies={ESSENTIAL_COOKIE_ROWS}
      />

      {/* 3. Analytics cookies */}
      <LegalSectionMolecule
        id='cookies-analityczne'
        kicker={tLegal('cookies.kicker.analytics')}
        title={t('sections.analytics.heading')}>
        <LegalParagraphAtom>{t('sections.analytics.body1')}</LegalParagraphAtom>
        <p className={`${styles.sectionText} ${sectionStyles.sectionNote}`}>
          {t('sections.analytics.note')}
        </p>
      </LegalSectionMolecule>

      {/* 4. Marketing cookies */}
      <LegalSectionMolecule
        id='cookies-marketingowe'
        kicker={tLegal('cookies.kicker.marketing')}
        title={t('sections.marketing.heading')}>
        <LegalParagraphAtom>{t('sections.marketing.body1')}</LegalParagraphAtom>
        <p className={`${styles.sectionText} ${sectionStyles.sectionNote}`}>
          {t('sections.marketing.note')}
        </p>
      </LegalSectionMolecule>

      {/* 5. Managing cookies */}
      <LegalSectionMolecule
        id='zarzadzanie-cookies'
        kicker={tLegal('cookies.kicker.managing')}
        title={t('sections.managing.heading')}>
        <LegalParagraphAtom>{t('sections.managing.body1')}</LegalParagraphAtom>
        <p className={sectionStyles.sectionSubtitle}>
          {t('sections.managing.browserSubtitle')}
        </p>
        <BrowserInstructions />
        <LegalParagraphAtom>
          {t('sections.managing.mobileCookies')}
        </LegalParagraphAtom>
      </LegalSectionMolecule>

      {/* 6. Your consent */}
      <LegalSectionMolecule
        id='twoja-zgoda'
        kicker={tLegal('cookies.kicker.consent')}
        title={t('sections.consent.heading')}>
        <LegalParagraphAtom>
          {renderVoidTags(t.raw('sections.consent.body1'), {
            cookieName: (
              <code className={sectionStyles.cookieName}>
                cookie-consent-v1
              </code>
            ),
          })}
        </LegalParagraphAtom>
        <LegalParagraphAtom>
          {renderVoidTags(t.raw('sections.consent.body2'), {
            email: (
              <a
                href={`mailto:${BRAND_CONFIG.email.contact}`}
                className={sectionStyles.emailLink}>
                {BRAND_CONFIG.email.contact}
              </a>
            ),
            privacyLink: (
              <AppParagraphLinkAtom
                prefetch={false}
                href={ROUTES_FRONT.PRIVACY}
                className={sectionStyles.emailLink}>
                {t('sections.consent.privacyLinkLabel')}
              </AppParagraphLinkAtom>
            ),
          })}
        </LegalParagraphAtom>
      </LegalSectionMolecule>
    </>
  );
}
