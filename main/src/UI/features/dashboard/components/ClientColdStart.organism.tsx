// UI/features/dashboard/components/ClientColdStart.organism.tsx
// Cold-start client experience: shown to a client with no ACTIVE stylist pair.
//
// DECISION (nie usuwaj tego komentarza):
// Rendered for the "no active pairs" client state (usePairedStylists → empty).
// That set covers BOTH a never-paired client AND one whose request is still
// PENDING: PAIRING_GET_MY_PAIRS returns ACTIVE pairs only, and the dashboard
// has no global "my pending request" query, so a pending client also lands
// here. The „already scanned?” row handles that case without the signal (a
// dedicated pending screen belongs with the claim-pairing flow).
//
// Purpose: the client app has no usable surface before pairing — gallery,
// favorites and sessions all require a paired stylist, and Explore is parked
// (EXPLORE_ENABLED cold-start OFF). An empty dashboard reads as a broken app,
// so this block says WHAT to do, WHAT unlocks after connecting, and carries
// the single filled action. It disappears once the client is paired.
//
// S126: built from shared primitives (EmptyStateAtom, ButtonAtom, NavRow).
// The hand-made card button with an orb and the raw row with a drawn caret
// are gone; the intro paragraph merged into the description (one statement
// of the fact instead of three).

import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { useCurrentLang } from '../../../hooks/useCurrentLang';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { EmptyStateAtom } from '../../../components/EmptyState/EmptyState.atom';
import { IllustrationAtom } from '../../../components/Illustration/Illustration.atom';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../../components/NavRow/NavRow.molecule';
import { LP_ASSETS } from '../../../assets/lpAssets';
import styles from './ClientColdStart.module.css';

export function ClientColdStartOrganism() {
  const router = useRouter();
  const t = useTranslations('dashboard.client');
  const lang = useCurrentLang();

  // The three things a paired client gains: plain words, no icons, so the
  // list never reads as three more buttons.
  const unlocks = [
    t('coldStart.unlockGallery'),
    t('coldStart.unlockFavorites'),
    t('coldStart.unlockSessions'),
  ];

  return (
    <>
      <EmptyStateAtom
        size='page'
        className={styles.empty}
        lang={lang}
        illustration={
          <IllustrationAtom src={LP_ASSETS.empty.emptyPairing} size='md' />
        }
        title={t('pairingHeroTitle')}
        titleAs='h2'
        description={t('pairingHeroBody')}
        action={
          <ButtonAtom
            variant='primary'
            size='lg'
            direction='forward'
            className='haptic-press'
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

      {/* "Already scanned?" — the dashboard has no pending signal, so this is
          the secondary path for a client who already sent a request; it leads
          to the pairing screen, where the per-stylist status lives. */}
      <NavRowListMolecule ariaLabel={t('coldStart.pendingHint')}>
        <NavRowMolecule
          href={ROUTES_FRONT.PAIRING}
          label={t('coldStart.pendingHint')}
          description={t('coldStart.pendingHintBody')}
          trailing='chevron'
        />
      </NavRowListMolecule>
    </>
  );
}
