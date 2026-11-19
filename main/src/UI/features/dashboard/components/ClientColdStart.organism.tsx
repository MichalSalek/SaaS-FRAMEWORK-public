// UI/features/dashboard/components/ClientColdStart.organism.tsx
// Cold-start client experience: shown to a client with no ACTIVE stylist pair.
//
// Waiting requests are rendered by the dashboard for both paired and unpaired clients.
// This block offers another scan only once that waiting state is known.

import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { useCurrentLang } from '../../../hooks/useCurrentLang';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { EmptyStateAtom } from '../../../components/EmptyState/EmptyState.atom';
import { IllustrationAtom } from '../../../components/Illustration/Illustration.atom';
import { LP_ASSETS } from '../../../assets/lpAssets';
import styles from './ClientColdStart.module.css';

export function ClientColdStartOrganism({
  pendingCount,
}: {
  pendingCount: number | undefined;
}) {
  const router = useRouter();
  const t = useTranslations('dashboard.client');
  const lang = useCurrentLang();
  if (pendingCount === undefined) {
    return null;
  }

  // The three things a paired client gains: plain words, no icons, so the
  // list never reads as three more buttons.
  const unlocks = [
    t('coldStart.unlockGallery'),
    t('coldStart.unlockFavorites'),
    t('coldStart.unlockSessions'),
  ];

  return (
    <EmptyStateAtom
      size='page'
      className={styles.empty}
      lang={lang}
      illustration={
        <IllustrationAtom src={LP_ASSETS.empty.clientStart} size='md' />
      }
      title={t('pairingHeroTitle')}
      titleAs='h2'
      // With a request already waiting, the scan is for ANOTHER stylist: the filled button and
      // „scan and wait” made her think her request failed (user-eyes review), so the hero steps
      // back.
      description={
        pendingCount > 0 ? t('coldStart.anotherBody') : t('pairingHeroBody')
      }
      action={
        <ButtonAtom
          variant={pendingCount > 0 ? 'outlined' : 'primary'}
          size='lg'
          direction='forward'
          className='press-feedback'
          onClick={() => void router.push(ROUTES_FRONT.PAIRING)}>
          {t('coldStart.cta')}
        </ButtonAtom>
      }>
      <div className={styles.unlocks}>
        <h3 className={styles.unlocksLabel}>{t('coldStart.unlocksLabel')}</h3>
        <ul className={styles.unlockList}>
          {unlocks.map(text => (
            <li key={text} lang={lang}>
              {text}
            </li>
          ))}
        </ul>
      </div>
    </EmptyStateAtom>
  );
}
