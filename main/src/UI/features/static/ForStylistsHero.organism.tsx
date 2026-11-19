// UI/features/static/ForStylistsHero.organism.tsx
// The hero of the page for stylists.
//
// DECISION: the hero media is the tap-filterable gallery (photos sell better).
// The drawn client conversation from the other candidate lives lower, in
// the inspiration-session section and on the home page. (owner)

import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { LpHeroOrganism } from '../../components/LpHero/LpHero.organism';
import { GalleryFilterDemoOrganism } from '../shared/lpScenes/GalleryFilterDemo.organism';
import styles from './ForStylistsPage.module.css';

interface ForStylistsHeroProps {
  onSignup: () => void;
}

export function ForStylistsHeroOrganism({ onSignup }: ForStylistsHeroProps) {
  const t = useTranslations('static.forStylists');
  return (
    <LpHeroOrganism
      headingId='stylists-hero-heading'
      headline={t('hero.headlineLine1')}
      headlineAccent={t('hero.headlineAccent')}
      lead={t('hero.lead')}
      lede={t('hero.lede')}
      shimmerCta
      className={styles.heroWideMedia}
      actions={
        <ButtonAtom
          direction='forward'
          variant='primary'
          size='lg'
          onClick={onSignup}>
          {t('hero.cta')}
        </ButtonAtom>
      }
      meta={t('hero.proof1')}
      aside={
        <AppParagraphLinkAtom href={ROUTES_FRONT.FOR_CLIENTS}>
          {t('hero.ctaForClients')}
        </AppParagraphLinkAtom>
      }
      media={<GalleryFilterDemoOrganism size='hero' />}
    />
  );
}
