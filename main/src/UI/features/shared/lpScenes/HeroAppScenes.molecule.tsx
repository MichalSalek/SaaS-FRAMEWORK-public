// UI/features/shared/lpScenes/HeroAppScenes.molecule.tsx
// Scenes built from the PRODUCT: the phone with a client's session, and a
// conversation before a visit. Small pictures drawn with the app's own atoms,
// used as hero media and inside sections. Each is one picture for assistive
// technology.

import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { LP_ASSETS } from '../../../assets/lpAssets';
import { AvatarAtom } from '../../../components/Avatar/Avatar.atom';
import { PhoneMockupMolecule } from '../../../components/PhoneMockup/PhoneMockup.molecule';
import { useAppScreenshots } from '../../../assets/useAppScreenshots';
import styles from './heroScenes.module.css';

const { hero, portfolio } = LP_ASSETS;

const SESSION_PHOTOS = [
  portfolio.nail50LongBlackCherry,
  hero.heroNail17GlazedKnit,
  portfolio.nail09ShortNude,
] as const;

/**
 * `aboveFold`: the thumbs sit in a hero's first screen. On the home page at
 * phone width a lazy thumb of the session card was the Largest Contentful Paint
 * element and waited for the lazy-load observer (`loading=lazy` flagged on the LCP).
 */
function SessionThumbs({ aboveFold = false }: { aboveFold?: boolean }) {
  return (
    <span className={styles.thumbs} aria-hidden='true'>
      {SESSION_PHOTOS.map(src => (
        <span key={src} className={styles.thumb}>
          <Image
            src={src}
            alt=''
            fill
            sizes='64px'
            loading={aboveFold ? 'eager' : 'lazy'}
            className={styles.cover}
          />
        </span>
      ))}
    </span>
  );
}

/**
 * The phone with the gallery and the session a client has just sent, for a
 * centred hero on a white band. The band's lower edge cuts the phone (owner),
 * so the hero stays short and the phone invites the scroll.
 */
export function HeroPhoneStageMolecule() {
  const t = useTranslations('components.lpScenes.phoneScene');
  const appScreen = useAppScreenshots();
  return (
    <div className={styles.stage}>
      <div className={styles.stagePhone}>
        <div className={styles.stagePhoneClip}>
          <PhoneMockupMolecule
            label={t('phoneLabel')}
            route='/app/gallery'
            size='lg'
            screenshot={appScreen('appGalleryFeed')}
            aboveFold
            // The clip draws the 260px frame at about 228px on a phone and
            // 246px from 768px (DOM probe). This is the home LCP.
            sizes='(min-width: 768px) 250px, 232px'
          />
        </div>
        <div
          className={styles.sessionNote}
          role='img'
          aria-label={t('noteLabel')}>
          <SessionThumbs aboveFold />
          <span className={styles.sessionNoteText} aria-hidden='true'>
            <span className={styles.sceneTitle}>{t('sessionTitle')}</span>
            <span className={styles.sceneMeta}>{t('sessionMeta')}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * A client's session and three lines of talk before the visit.
 * `surface`: `card` is a white card for a paper band; `paper` is the same
 * scene on a paper panel, for a WHITE band (a white card would have no edge
 * there).
 */
export function HeroChatSceneMolecule({
  surface = 'card',
}: {
  surface?: 'card' | 'paper';
}) {
  const t = useTranslations('components.lpScenes.chat');
  return (
    <div
      className={styles.chatScene}
      data-surface={surface}
      role='img'
      aria-label={t('label')}>
      <div className={styles.chatHead} aria-hidden='true'>
        <AvatarAtom name={t('clientName')} size='sm' decorative />
        <span className={styles.sceneTitle}>{t('clientName')}</span>
      </div>
      <div className={styles.chatBody} aria-hidden='true'>
        <div className={styles.chatSession}>
          <SessionThumbs />
          <span className={styles.sessionNoteText}>
            <span className={styles.sceneTitle}>{t('sessionTitle')}</span>
            <span className={styles.sceneMeta}>{t('sessionMeta')}</span>
          </span>
        </div>
        <p className={styles.bubble} data-from='client'>
          {t('message1')}
        </p>
        <p className={styles.bubble} data-from='stylist'>
          {t('message2')}
        </p>
        <p className={styles.bubble} data-from='client'>
          {t('message3')}
        </p>
      </div>
    </div>
  );
}
