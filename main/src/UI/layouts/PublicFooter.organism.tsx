import { AppParagraphLinkAtom } from '../components/AppParagraphLink/AppParagraphLink.atom';
import { useTranslations } from 'next-intl';
import {
  PaperPlaneTiltIcon,
  ShieldCheckIcon,
  EyeSlashIcon,
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
            {/* System status: the public Better Stack status page (uptime history, incidents,
                subscription). The address comes from BRAND_CONFIG (domain identity); the old
                `nailfolio-app.betteruptime.com` 301-redirects to it. The internal /status
                (SSR probe of our backend) stays: ServerErrorPage (500) links it. */}
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
            {/* prefetch={false} (CWV): the footer is on every static page, so Next would prefetch
                the chunks of 4 legal pages whenever the footer enters the viewport, and only a
                fraction of users click them. Navigation works as usual (the chunk loads on click). */}
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
            {/* DECISION: no TikTok or Facebook icons; there are no such profiles. A network
              gets an icon only with a real handle in BRAND_CONFIG.social and content on
              the profile (owner). */}
          </nav>
        )}

        {/* Section 5: Company info + copyright */}
        <div className={styles.footerBottom}>
          {/* The nf mark as the brand sign-off above the company line (SSOT BrandMarkAtom);
              decorative: the copyright below carries the name. */}
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
