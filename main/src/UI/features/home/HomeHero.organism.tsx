// UI/features/home/HomeHero.organism.tsx
// The home page hero.

// DECISION: VIDEO-KOD, an approved explainer replaces the clipped phone with an inline vertical
// player. Desktop text moves left; the mobile content/actions remain ahead of the compact cover.
// Missing locale media keeps the original centred composition described below.

// DECISION: the home hero is a WHITE band with centred short text and, under it, the phone with the
// gallery on which a client's session card stands; the band's lower edge cuts the phone, so the
// hero is low and the cut phone invites scrolling. No small label above the headline: the `<h1>` is
// a large headline carrying the category name ("Portfolio paznokci"). Measured in a blind
// first-screen test (two readers each): a benefit headline instead of the category scored
// confidence 3 and 3 on "what is this" against 4 and 4. One line under the button, with no sentence
// about paid-plan prices ("w ogóle niepotrzebne"). Direction: high contrast, little text,
// everything consumable in 2 s. The sections under the hero have backgrounds matched to the white
// band (gallery on paper, conversation on white): HomePage.composition. (owner)

import { useLocale, useTranslations } from 'next-intl';
import clsx from 'clsx';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { LpHeroOrganism } from '../../components/LpHero/LpHero.organism';
import { HeroPhoneStageMolecule } from '../shared/lpScenes/HeroAppScenes.molecule';
import { MarketingVideoOrganism } from '../shared/marketingVideo/MarketingVideo.organism';
import { resolveMarketingVideo } from '../shared/marketingVideo/marketingVideo.config';
import type { MarketingVideoRegistry } from '../shared/marketingVideo/marketingVideo.config';
import styles from './HomePage.module.css';
import videoStyles from './HomeHeroVideo.module.css';

interface HomeHeroProps {
  onSignup: () => void;
  /** Dependency injection for private previews/tests; the public page uses approved assets only. */
  videoRegistry?: MarketingVideoRegistry;
}

export function HomeHeroOrganism({ onSignup, videoRegistry }: HomeHeroProps) {
  const t = useTranslations('pages.home');
  const locale = useLocale();
  const video = resolveMarketingVideo(locale, videoRegistry);
  return (
    <LpHeroOrganism
      headingId='home-hero-heading'
      layout={video ? 'split' : 'center'}
      tone='white'
      className={clsx(video ? videoStyles.heroWithVideo : styles.heroEdge)}
      headline={t('hero.headlineLine1')}
      headlineAccent={t('hero.headlineAccent')}
      lede={t('hero.lede')}
      shimmerCta
      actions={
        <ButtonAtom
          direction='forward'
          variant='primary'
          size='lg'
          onClick={onSignup}>
          {t('hero.ctaPrimary')}
        </ButtonAtom>
      }
      meta={t('hero.proof1')}
      aside={
        <AppParagraphLinkAtom href={ROUTES_FRONT.FOR_CLIENTS}>
          {t('hero.ctaForClients')}
        </AppParagraphLinkAtom>
      }
      media={
        video ? (
          <MarketingVideoOrganism
            key={`${video.asset.version}-${locale}`}
            media={video}
          />
        ) : (
          <HeroPhoneStageMolecule />
        )
      }
    />
  );
}
