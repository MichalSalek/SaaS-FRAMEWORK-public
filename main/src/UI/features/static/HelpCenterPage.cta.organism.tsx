import { useTranslations } from 'next-intl';
import {
  CreditCardIcon,
  EnvelopeIcon,
  ImagesIcon,
  LinkSimpleIcon,
  PaperPlaneTiltIcon,
  QrCodeIcon,
  UserCircleIcon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { EyebrowAtom } from '../../components/Eyebrow/Eyebrow.atom';
import styles from './HelpCenterPage.module.css';
import { trackCtaClick } from '../../../application/analytics/cta-events';

/* ─── Popular tags (search chips below hero search) ─── */

const POPULAR_TAGS = [
  { key: 'qr', icon: QrCodeIcon },
  { key: 'gallery', icon: ImagesIcon },
  { key: 'session', icon: PaperPlaneTiltIcon },
  { key: 'subscription', icon: CreditCardIcon },
  { key: 'account', icon: UserCircleIcon },
] as const;

interface PopularTagsProps {
  onTagClick: (query: string) => void;
}

export function PopularTagsOrganism({ onTagClick }: PopularTagsProps) {
  const t = useTranslations('static.helpCenter');

  return (
    <div className={styles.popularTagsRow}>
      <span className={styles.popularTagsLabel}>
        {t('hero.popularTagsLabel')}
      </span>
      <div className={styles.popularTagsChips}>
        {POPULAR_TAGS.map(tag => {
          const Icon = tag.icon;
          const label = t(`hero.popularTags.${tag.key}`);
          return (
            <button
              key={tag.key}
              type='button'
              className={styles.popularTagChip}
              onClick={() => {
                onTagClick(label);
              }}>
              <Icon size={14} weight='duotone' aria-hidden='true' />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Contact CTA footer (Vercel-style "Still need help?") ─── */

export function ContactFooterOrganism() {
  const t = useTranslations('static.helpCenter');

  return (
    <section
      className={`${styles.contactFooter} ${styles.contactFooterNegative}`}
      aria-label={t('contactFooter.headline')}>
      <div className={styles.contactFooterInner}>
        <span className={styles.contactFooterIcon} aria-hidden='true'>
          <LinkSimpleIcon size={28} weight='duotone' />
        </span>
        <EyebrowAtom
          as='p'
          variant='plain'
          className={styles.contactFooterEyebrow}>
          {t('contactFooter.eyebrow')}
        </EyebrowAtom>
        <h2 className={styles.contactFooterHeadline}>
          {t('contactFooter.headline')}
        </h2>
        <p className={styles.contactFooterLede}>{t('contactFooter.lede')}</p>
        <div className={styles.contactFooterActions}>
          {/* No className: the old outer-<Link> .contactFooterPrimaryLink only
              reset anchor defaults (text-decoration:none + color:inherit), which
              LinkButtonAtom's button styling already provides. Carrying color:inherit
              onto the button anchor would tie specificity with the primary variant's
              color and risk overriding the accent text color. */}
          <LinkButtonAtom
            direction='forward'
            href={ROUTES_FRONT.CONTACT}
            variant='primary'
            size='lg'>
            {t('contactFooter.primaryCta')}
          </LinkButtonAtom>
          <a
            href={`mailto:${t('contactFooter.email')}`}
            className={styles.contactFooterSecondary}>
            <EnvelopeIcon size={16} weight='duotone' aria-hidden='true' />
            <span>{t('contactFooter.email')}</span>
          </a>
        </div>
      </div>
    </section>
  );
}

/* ─── Bottom CTA (secondary path to product) ─── */

export function BottomCtaOrganism() {
  const t = useTranslations('static.helpCenter');

  return (
    <section
      className={styles.bottomCtaSection}
      style={{ '--stagger-index': 3 } as React.CSSProperties}>
      <div className={styles.bottomCtaInner}>
        <h2 className={styles.bottomCtaHeadline}>{t('bottomCta.headline')}</h2>
        <div className={styles.bottomCtaActions}>
          {/* Jeden filled na dole help-center: kontakt wyżej; tu ścieżka produktowa. */}
          <LinkButtonAtom
            direction='forward'
            href={ROUTES_FRONT.FOR_STYLISTS}
            variant='outlined'
            size='lg'
            onClick={() => trackCtaClick('help-center-after')}>
            {t('bottomCta.forStylists')}
          </LinkButtonAtom>
          <LinkButtonAtom
            href={ROUTES_FRONT.PRICING}
            variant='outlined'
            size='lg'
            onClick={() => trackCtaClick('help-center-after')}>
            {t('bottomCta.pricing')}
          </LinkButtonAtom>
        </div>
      </div>
    </section>
  );
}
