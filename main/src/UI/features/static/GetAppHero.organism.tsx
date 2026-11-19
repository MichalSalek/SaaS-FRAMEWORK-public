import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { LpHeroOrganism } from '../../components/LpHero/LpHero.organism';
import { PhoneMockupMolecule } from '../../components/PhoneMockup/PhoneMockup.molecule';
import { useAppScreenshots } from '../../assets/useAppScreenshots';
import { GetAppStoreButtonsMolecule } from './GetAppStoreButtons.molecule';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import styles from './GetAppHero.module.css';

/**
 * Scroll target of the funnel CTAs in 'get-app' mode (a computer on
 * PREVIEW/PROD): the hero's action block, where the QR code that opens
 * Nailfolio on the phone stands. The host page puts this id on the wrapper of
 * what it passes as `actions`. It is not the store notes under the phones: those
 * are already on screen, so scrolling to them would show nothing new.
 */
export const GET_APP_STORES_ANCHOR_ID = 'getapp-open-on-phone';

/**
 * Who the banner speaks to and which surface it stands on.
 *
 * 'public'      : the public `/get-app`: canon (stores under the phones, a sales
 *                 voice to a stylist who has no account yet).
 * 'app-stylist' : web-home of a logged-in stylist: no stores, the copy speaks to
 *                 someone who already bought the product.
 * 'app-client'  : web-home of a logged-in client: the client's copy and screens.
 */
export type GetAppHeroVariant = 'public' | 'app-stylist' | 'app-client';

export interface GetAppHeroProps {
  /** id of the headline: the section gets aria-labelledby. Required: the banner is
   *  the heading of its surface, and every page has its own id. */
  headingId: string;
  /** Skin of the host surface (e.g. leaving full-bleed in /app). */
  className?: string;
  /** Defaults to the public canon: `/get-app` passes no variant. */
  variant?: GetAppHeroVariant;
  /** Hero action on `app-*` surfaces; there are no store buttons there. */
  actions?: ReactNode;
}

/**
 * GetAppHero: the „Nailfolio bierzesz na telefon" hero: a collage of two phones
 * (gallery + conversation, editorial offset) and store buttons under the product.
 *
 * DECISION: ONE component serves both `/get-app` and the logged-in desktop web-home
 * `/app/home`, so a banner change lands in both; a third surface mounts this
 * component, never copies its JSX. No label above the headline. (owner)
 *
 * DECISION: copy, phone screens and action follow `variant` instead of a second
 * component: a client must not see the stylist sales pitch. Default = public `/get-app`.
 *
 * i18n: `static.getApp` (`hero.*`, `heroInApp.{stylist,client}.*`) plus `pages.home`
 * (label of the second phone). BOTH host pages load `static.getApp`; the `app-*`
 * branch cannot depend on a namespace that `/get-app` does not load.
 */
export function GetAppHeroOrganism({
  headingId,
  className,
  variant = 'public',
  actions,
}: GetAppHeroProps) {
  const t = useTranslations('static.getApp');
  const appScreen = useAppScreenshots();
  // Shared translated labels describe the conversation in the second phone.
  const tHomeBenefits = useTranslations('pages.home.benefits');
  const tHomeHero = useTranslations('pages.home.hero');

  const isPublic = variant === 'public';
  const isClient = variant === 'app-client';

  // Literal keys (not concatenated): typed next-intl messages.
  const copy = isPublic
    ? {
        headline: t('hero.headlineLine1'),
        accent: t('hero.headlineAccent'),
        lede: t('hero.lede'),
        meta: t('hero.freeNote'),
      }
    : isClient
      ? {
          headline: t('heroInApp.client.headlineLine1'),
          accent: t('heroInApp.client.headlineAccent'),
          lede: t('heroInApp.client.lede'),
          meta: t('heroInApp.client.meta'),
        }
      : {
          headline: t('heroInApp.stylist.headlineLine1'),
          accent: t('heroInApp.stylist.headlineAccent'),
          lede: t('heroInApp.stylist.lede'),
          meta: t('heroInApp.stylist.meta'),
        };

  // Collage: a client sees HER screens (sessions + client dashboard). The stylist's
  // gallery screenshot is signed with a demo-account name burned into the bitmap,
  // so on the client surface it would be someone else's identity over half the screen.
  const collage = isClient ? (
    <div className={styles.collage}>
      <div className={styles.collagePrimary}>
        <PhoneMockupMolecule
          label={t('heroInApp.client.mockupLabel')}
          route='/app/sessions'
          state={t('heroInApp.client.mockupState')}
          size='lg'
          screenshot={appScreen('appClientSessions')}
        />
      </div>
      <div className={styles.collageSecondary}>
        <PhoneMockupMolecule
          label={t('heroInApp.client.mockupSecondaryLabel')}
          route='/app'
          state={t('heroInApp.client.mockupSecondaryState')}
          size='md'
          screenshot={appScreen('appClientHome')}
        />
      </div>
    </div>
  ) : (
    <div className={styles.collage}>
      <div className={styles.collagePrimary}>
        <PhoneMockupMolecule
          label={t('hero.mockupLabel')}
          route='/app'
          size='lg'
          screenshot={appScreen('appDashboard')}
        />
      </div>
      <div className={styles.collageSecondary}>
        <PhoneMockupMolecule
          label={tHomeBenefits('conversationLabel')}
          route='/app/messages'
          state={tHomeBenefits('conversationState')}
          size='md'
          screenshot={appScreen('appThread')}
        />
      </div>
    </div>
  );

  return (
    <LpHeroOrganism
      headline={copy.headline}
      headlineAccent={copy.accent}
      lede={copy.lede}
      actions={actions}
      meta={copy.meta}
      aside={
        isPublic ? (
          <AppParagraphLinkAtom href={ROUTES_FRONT.FOR_CLIENTS}>
            {tHomeHero('ctaForClients')}
          </AppParagraphLinkAtom>
        ) : undefined
      }
      headingId={headingId}
      className={clsx(className)}

      tone={isPublic ? 'white' : 'paper'}
      media={
        isPublic ? (
          <div className={styles.mediaWithStores}>
            {collage}
            <div className={styles.storesAnchor}>
              <GetAppStoreButtonsMolecule />
            </div>
          </div>
        ) : (
          collage
        )
      }
    />
  );
}
