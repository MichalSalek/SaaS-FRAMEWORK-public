// UI/features/account/components/StylistProfileSection.saveLine.molecule.tsx
// Stan zapisu formularza wizytówki: JEDNA linia, zamontowana zawsze.
//
// DECISION (nie usuwaj tego komentarza) — owner 2026-10-08:
// formularz zapisuje się sam (autosave przy wyjściu z pola, dyrektywa
// 2026-07-12), ale nic na ekranie tego nie mówiło: census S126 opisał go jako
// „długi formularz bez widocznego zapisu”. „Zapisywanie...” doklejało się do
// tytułu, a błąd wskakiwał jako nowy wiersz i spychał wszystkie pola. Linia ma
// stałą wysokość (na przycisk „Ponów”), więc zmiana stanu niczego nie
// przesuwa. Kolejność stanów: zapis w toku, nieudany, potwierdzenie, a zanim
// cokolwiek zapisano, objaśnienie mechanizmu. Toast sukcesu z interceptora
// zostaje (znika po chwili); ta linia jest stanem trwałym.

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import styles from './StylistProfileSection.module.css';

interface ProfileSaveLineProps {
  isSaving: boolean;
  hasFailure: boolean;
  onRetry: () => void;
}

export function ProfileSaveLineMolecule({
  isSaving,
  hasFailure,
  onRetry,
}: ProfileSaveLineProps) {
  const t = useTranslations('account.profile');
  const tButtons = useTranslations('buttons');
  const [savedOnce, setSavedOnce] = useState(false);
  const wasSavingRef = useRef(false);
  useEffect(() => {
    if (wasSavingRef.current && !isSaving && !hasFailure) {
      setSavedOnce(true);
    }
    wasSavingRef.current = isSaving;
  }, [isSaving, hasFailure]);

  const state = isSaving
    ? 'saving'
    : hasFailure
      ? 'failed'
      : savedOnce
        ? 'saved'
        : 'idle';
  const TEXT = {
    saving: t('savePending'),
    failed: t('saveFailed'),
    saved: t('saveDone'),
    idle: t('saveIdle'),
  } as const;

  return (
    <div
      className={styles.saveLine}
      data-state={state}
      role='status'
      aria-live='polite'>
      <span>{TEXT[state]}</span>
      {state === 'failed' && (
        <ButtonAtom variant='outlined' size='sm' onClick={onRetry}>
          {tButtons('retry')}
        </ButtonAtom>
      )}
    </div>
  );
}
