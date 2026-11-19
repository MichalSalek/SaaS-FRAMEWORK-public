import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { LockKeyIcon } from '@phosphor-icons/react';
import { useReportHeroVisibility } from '../../components/AppHero/useReportHeroVisibility';
import { ButtonAtom } from '../../components/Button/Button.atom';
import styles from './ClientCardPage.module.css';

export function ClientCardLockedOrganism({
  trialAvailable,
  onCta,
}: {
  trialAvailable: boolean;
  onCta: () => void;
}) {
  const t = useTranslations('clientCard');
  // The locked card with an h1 = the screen's local hero (markup deliberately different from
  // AppHero) — reports visibility to AppLayout (SSOT of the large-title mechanism) so the top bar
  // does not duplicate the title while the card is in frame (pattern OnboardingHero).
  const heroRef = useRef<HTMLElement | null>(null);
  useReportHeroVisibility(heroRef);
  return (
    <div className={styles.lockedWrap}>
      <section ref={heroRef} className={styles.locked}>
        <span className={styles.lockedIcon} aria-hidden='true'>
          <LockKeyIcon size={30} />
        </span>
        <h1 className={styles.lockedTitle}>{t('lockedTitle')}</h1>
        <p className={styles.lockedBody}>{t('lockedBody')}</p>
        <ButtonAtom
          type='button'
          variant='primary'
          size='md'
          icon={<LockKeyIcon size={16} weight='bold' />}
          onClick={onCta}>
          {trialAvailable ? t('lockedTrialCta') : t('lockedUpgradeCta')}
        </ButtonAtom>
      </section>
      <LockedJournalTeaser />
    </div>
  );
}

/* A faded, static preview of the journal — shows the value of the Pro plan instead of an empty
   screen. aria-hidden: a persuasive decoration, not content. */
function LockedJournalTeaser() {
  const t = useTranslations('clientCard');
  const entries = [
    { date: t('teaserDate1'), note: t('teaserNote1'), photos: 3 },
    { date: t('teaserDate2'), note: t('teaserNote2'), photos: 2 },
  ];
  return (
    <div className={styles.lockedPreview} aria-hidden='true'>
      <p className={styles.lockedTeaserLabel}>{t('lockedTeaserLabel')}</p>
      {entries.map((entry, i) => (
        <div key={i} className={styles.previewEntry}>
          <time className={styles.visitDate}>{entry.date}</time>
          <p className={styles.previewNote}>{entry.note}</p>
          <div className={styles.previewPhotos}>
            {Array.from({ length: entry.photos }).map((_, p) => (
              <span key={p} className={styles.previewPhotoTile} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
