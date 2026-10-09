import { AppParagraphLinkAtom } from '../components/AppParagraphLink/AppParagraphLink.atom';
import { useTranslations } from 'next-intl';
import {
  PaperPlaneTiltIcon,
  ShieldCheckIcon,
  EyeSlashIcon,
  GlobeIcon,
  FlagIcon,
  InstagramLogoIcon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { TypographyAtom } from '../components/Typography/Typography.atom';
import { NewsletterInlineFormOrganism } from '../features/shared/newsletter/NewsletterInlineForm.organism';
import { usePublicFeatureFlag } from '../../application/feature-flags/client-feature-flags';
import { ExternalLinkAtom } from '../components/ExternalLink/ExternalLink.atom';
import { BrandMarkAtom } from '../components/BrandMark/BrandMark.atom';
import { BRAND_SOCIAL_PROFILES_PUBLIC } from '../shared/brandSocial';
import styles from './PublicLayout.module.css';

/**
 * PublicFooter — 5 sections:
 *   1. Links (3 columns: Produkt, Firma, Prawne)
 *   2. Newsletter signup (wired to POST /api/v1/public/newsletter-subscribe + GDPR consent)
 *   3. Trust badges (Bez reklam, Bez śledzenia, Dane w Europie, Polskie narzędzie)
 *   4. Social links (Instagram, TikTok, Facebook)
 *   5. Company info + copyright
 */
export function PublicFooterOrganism() {
  const t = useTranslations('layout.publicFooter');
  const tNav = useTranslations('nav');
  const tMenu = useTranslations('menu');
  const blogEnabled = usePublicFeatureFlag(FEATURE_FLAG_KEYS.BLOG_ENABLED);

  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        {/* Section 1: Links — 3 columns */}
        <div className={styles.footerLinks}>
          <div className={styles.footerColumn}>
            <TypographyAtom variant='caption' className={styles.footerTitle}>
              {t('sectionProduct')}
            </TypographyAtom>
            <AppParagraphLinkAtom
              href={ROUTES_FRONT.FOR_STYLISTS}
              className={styles.footerLink}>
              {tNav('forStylists')}
            </AppParagraphLinkAtom>
            <AppParagraphLinkAtom
              href={ROUTES_FRONT.FOR_CLIENTS}
              className={styles.footerLink}>
              {tNav('forClients')}
            </AppParagraphLinkAtom>
            <AppParagraphLinkAtom
              href={ROUTES_FRONT.FOR_STUDIOS}
              className={styles.footerLink}>
              {tNav('forStudios')}
            </AppParagraphLinkAtom>
            <AppParagraphLinkAtom
              href={ROUTES_FRONT.PRICING}
              className={styles.footerLink}>
              {tNav('pricing')}
            </AppParagraphLinkAtom>
            <AppParagraphLinkAtom
              href={ROUTES_FRONT.GET_APP}
              className={styles.footerLink}>
              {tNav('getApp')}
            </AppParagraphLinkAtom>
            <AppParagraphLinkAtom
              href={ROUTES_FRONT.COMPARE}
              className={styles.footerLink}>
              {tNav('compare')}
            </AppParagraphLinkAtom>
            <AppParagraphLinkAtom
              href={ROUTES_FRONT.WELCOME}
              className={styles.footerLink}>
              {tNav('welcome')}
            </AppParagraphLinkAtom>
          </div>
          <div className={styles.footerColumn}>
            <TypographyAtom variant='caption' className={styles.footerTitle}>
              {t('sectionCompany')}
            </TypographyAtom>
            <AppParagraphLinkAtom
              href={ROUTES_FRONT.ABOUT}
              className={styles.footerLink}>
              {tNav('about')}
            </AppParagraphLinkAtom>
            <AppParagraphLinkAtom
              href={ROUTES_FRONT.CONTACT}
              className={styles.footerLink}>
              {tNav('contact')}
            </AppParagraphLinkAtom>
            {blogEnabled && (
              <AppParagraphLinkAtom
                href={ROUTES_FRONT.BLOG}
                className={styles.footerLink}>
                {tNav('blog')}
              </AppParagraphLinkAtom>
            )}
            <AppParagraphLinkAtom
              href={ROUTES_FRONT.SITE_MAP}
              className={styles.footerLink}>
              {t('siteMap')}
            </AppParagraphLinkAtom>
            <AppParagraphLinkAtom
              href={ROUTES_FRONT.HELP_CENTER}
              className={styles.footerLink}>
              {tMenu('helpCenter')}
            </AppParagraphLinkAtom>
            {/* Status systemu → publiczny status page Better Stack (historia
                uptime'u, incydenty, subskrypcja; bogatszy niż wewnętrzny /status).
                Adres bierze się z BRAND_CONFIG, bo to element tożsamości domeny:
                własna subdomena jest skonfigurowana u dostawcy i w DNS.
                Wewnętrzne /status (sonda SSR na naszym backendzie) zostaje —
                linkuje je ServerErrorPage (500). */}
            <AppParagraphLinkAtom
              external
              href={BRAND_CONFIG.statusUrl}
              className={styles.footerLink}>
              {tNav('status')}
            </AppParagraphLinkAtom>
          </div>
          <div className={styles.footerColumn}>
            <TypographyAtom variant='caption' className={styles.footerTitle}>
              {t('sectionLegal')}
            </TypographyAtom>
            {/* prefetch={false} (CWV): footer jest na kazdej stronie statycznej —
                Next prefetchowalby chunki 4 stron prawnych przy kazdym wejsciu
                footera w viewport, a klika je ulamek userow. Nawigacja dziala
                normalnie (chunk laduje sie on-click). */}
            <AppParagraphLinkAtom
              href={ROUTES_FRONT.TERMS}
              prefetch={false}
              className={styles.footerLink}>
              {tMenu('terms')}
            </AppParagraphLinkAtom>
            <AppParagraphLinkAtom
              href={ROUTES_FRONT.PRIVACY}
              prefetch={false}
              className={styles.footerLink}>
              {tMenu('privacy')}
            </AppParagraphLinkAtom>
            <AppParagraphLinkAtom
              href={ROUTES_FRONT.COOKIES}
              prefetch={false}
              className={styles.footerLink}>
              {tNav('cookies')}
            </AppParagraphLinkAtom>
            <AppParagraphLinkAtom
              href={ROUTES_FRONT.CONTENT_MODERATION}
              prefetch={false}
              className={styles.footerLink}>
              {tNav('contentModeration')}
            </AppParagraphLinkAtom>
          </div>
        </div>

        {/* Section 2: Newsletter signup — shared NewsletterInlineForm
            (consent-gated, consentSource='footer'). Button disabled-pale
            state before consent is BY DESIGN — see DECISION inside the
            shared component. */}
        <div className={styles.newsletter}>
          <NewsletterInlineFormOrganism
            inputVariant='field'
            consentSource='footer'
            placeholder={t('newsletterEmailPlaceholder')}
            inputAriaLabel={t('newsletterEmailAriaLabel')}
            ctaLabel={t('newsletterSubscribeButton')}
            successMessage={t('newsletterSuccess')}
            errorMessage={t('newsletterError')}
            ctaIcon={<PaperPlaneTiltIcon size={16} />}
            heading={
              <TypographyAtom variant='body2'>
                {t('newsletterTitle')}
              </TypographyAtom>
            }
            consentLabel={t.rich('newsletterConsentText', {
              privacyLink: chunks => (
                <AppParagraphLinkAtom
                  prefetch={false}
                  href={ROUTES_FRONT.PRIVACY}
                  className={styles.newsletterConsentLink}>
                  {chunks}
                </AppParagraphLinkAtom>
              ),
            })}
            renderSuccess={message => (
              <TypographyAtom
                variant='body2'
                className={styles.newsletterSuccess}
                role='status'>
                {message}
              </TypographyAtom>
            )}
            renderError={message => (
              <TypographyAtom
                variant='body2'
                className={styles.newsletterError}
                role='alert'>
                {message}
              </TypographyAtom>
            )}
            classNames={{
              form: styles.newsletterForm,
              row: styles.newsletterFormRow,
              input: styles.newsletterInput,
              consent: styles.newsletterConsent,
              consentText: styles.newsletterConsentText,
            }}
          />
        </div>

        {/* Section 3: Trust badges */}
        <ul
          className={styles.trustBadges}
          aria-label={t('trustBadgesAriaLabel')}>
          <li className={styles.trustBadge}>
            <ShieldCheckIcon size={16} aria-hidden='true' />
            <span>{t('trustNoAds')}</span>
          </li>
          <li className={styles.trustBadge}>
            <EyeSlashIcon size={16} aria-hidden='true' />
            <span>{t('trustNoTracking')}</span>
          </li>
          <li className={styles.trustBadge}>
            <GlobeIcon size={16} aria-hidden='true' />
            <span>{t('trustDataInEurope')}</span>
          </li>
          <li className={styles.trustBadge}>
            <FlagIcon size={16} aria-hidden='true' />
            <span>{t('trustPolishTool')}</span>
          </li>
        </ul>

        {/* Section 4: Social links — hidden until the profiles carry content
            (DECISION in UI/shared/brandSocial.ts). */}
        {BRAND_SOCIAL_PROFILES_PUBLIC && (
          <nav className={styles.socialLinks} aria-label={t('socialAriaLabel')}>
            <ExternalLinkAtom
              href={`https://instagram.com/${BRAND_CONFIG.social.instagram}`}
              aria-label='Instagram'
              className={styles.socialLink}>
              <InstagramLogoIcon size={20} aria-hidden='true' />
            </ExternalLinkAtom>
            {/* DECISION (nie usuwaj tego komentarza) — owner 2026-09-23:
              TikTok/Facebook icons REMOVED: there are no such profiles, and
              the icons linked bare tiktok.com/facebook.com. A network gets an
              icon here only together with a real handle in
              BRAND_CONFIG.social and content on the profile. */}
          </nav>
        )}

        {/* Section 5: Company info + copyright */}
        <div className={styles.footerBottom}>
          {/* Sygnet nf jako sign-off marki nad metryczką (SSOT BrandMarkAtom);
              dekoracyjny — copyright poniżej niesie nazwę. */}
          <BrandMarkAtom className={styles.footerBrandMark} />
          <TypographyAtom variant='caption' className={styles.companyInfo}>
            {t('companyInfo')}
          </TypographyAtom>
          <TypographyAtom variant='caption'>
            {t('copyright', { year: new Date().getFullYear() })}
          </TypographyAtom>
          <TypographyAtom variant='caption' className={styles.buildVersion}>
            v{process.env.NEXT_PUBLIC_BUILD_VERSION}
          </TypographyAtom>
        </div>
      </div>
    </footer>
  );
}
