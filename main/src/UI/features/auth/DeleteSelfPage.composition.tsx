// UI/features/auth/DeleteSelfPage.tsx
// Account deletion flow, three steps (GDPR Art. 17):
//   "review"  what closing the account means: the list of data in one white
//             box, the 90-day return window as plain text, the destructive
//             action and a visible way back.
//   "confirm" type-to-confirm gate + the destructive action; a failed request
//             says so next to the button, which becomes the retry.
//   "done"    which e-mail to look for and what happens next.
// House style: information on paper, grouped content in a white box, danger
// carried by the icon and the button colour (no tinted cards).
//
// DECISION (nie usuwaj tego komentarza) — vote `s126-proces`, owner 2026-10-09
// (with his decisions of 2026-10-08): the intro card and the three-orb stepper
// are replaced by the shared `ProcessHeaderMolecule` („Pasek i jedna linia”).
// The title „Usunięcie konta” lives in the top bar (a visible <h1> on the
// desktop account layout, which has no bar); the step's name is the
// indicator's line, so no step repeats it as a heading of its own.
// Stack: TQ v5 useMutation + CSS Modules + Phosphor.

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { CheckIcon, XCircleIcon } from '@phosphor-icons/react';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useNativeRouter } from '../../layouts/useNativeRouter';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { InputAtom } from '../../components/Input/Input.atom';
import { PageColumnsMolecule } from '../../components/PageColumns/PageColumns.molecule';
import { ProcessHeaderMolecule } from '../../components/ProcessHeader/ProcessHeader.molecule';
import { useDeleteSelf } from './hooks/useDeleteSelf';
import {
  DeleteSelfNoteAtom,
  type DeleteSelfStep,
} from './DeleteSelfPage.parts.atom';
import styles from './DeleteSelfPage.module.css';

/* ─── Inner page (rendered inside AppLayout) ─── */

function DeleteSelfPageInner() {
  const t = useTranslations('pages.deleteSelf');
  // Słowo potwierdzenia jest per język (PL „USUN", EN „DELETE", DE „LÖSCHEN") —
  // literał „USUN" kazał użytkowniczce EN/DE przepisać obce słowo.
  const CONFIRMATION_WORD = t('confirmWord');
  const nav = useNativeRouter();
  useAppBarTitle(t('title'));

  const [step, setStep] = useState<DeleteSelfStep>('review');
  const [confirmText, setConfirmText] = useState('');

  // Flow-pass §5b (S34): reset scrolla na top przy KAŻDEJ zmianie kroku flow.
  // #main-content = scroll-kontener AppLayout. Kanon: OnboardingPage (S32) +
  // UploadAssetPage (S33), ta sama klasa multi-step-wizard-w-inner-scroll-shell.
  useEffect(() => {
    const scroller = document.getElementById('main-content');
    if (scroller) {
      scroller.scrollTo({ top: 0 });
    } else if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0 });
    }
  }, [step]);

  const {
    mutate: requestDelete,
    isPending,
    isError,
    reset: resetRequest,
  } = useDeleteSelf();

  const isConfirmed = confirmText === CONFIRMATION_WORD;

  // DECISION (nie usuwaj tego komentarza) — owner 2026-10-08:
  // nieudane wysłanie zostaje NA EKRANIE (zdanie przy przycisku, a przycisk
  // staje się ponowieniem). Wcześniej jedynym śladem był znikający toast,
  // a ekran wyglądał, jakby nic się nie stało.
  const handleRequestDelete = () => {
    if (!isConfirmed || isPending) {
      return;
    }
    requestDelete(undefined, {
      onSuccess: () => {
        setStep('done');
      },
    });
  };

  // The same element first in every step's tree, so it stays mounted and the
  // bar's segments fill in place when the step changes.
  const steps: { id: DeleteSelfStep; label: string }[] = [
    { id: 'review', label: t('stepReview') },
    { id: 'confirm', label: t('stepConfirm') },
    { id: 'done', label: t('stepDone') },
  ];
  const header = (
    <ProcessHeaderMolecule
      title={t('title')}
      steps={steps}
      currentId={step}
      stepAriaLabel={t('stepsAriaLabel')}
      counterLabel={t('stepCounter', {
        current: steps.findIndex(item => item.id === step) + 1,
        total: steps.length,
      })}
    />
  );

  /* ── Step 1: Review ── */
  if (step === 'review') {
    return (
      <div className={styles.page}>
        {header}

        <PageColumnsMolecule
          main={
            <div className={styles.column}>
              <section className={styles.card}>
                <h2 className={styles.cardTitle}>{t('consequencesTitle')}</h2>
                <ul className={styles.consequencesList}>
                  {[
                    t('consequencesPhotos'),
                    t('consequencesInspirations'),
                    t('consequencesPairings'),
                    t('consequencesAccount'),
                  ].map(item => (
                    <li key={item} className={styles.consequenceItem}>
                      <span
                        className={`${styles.lineIcon} ${styles.dangerIcon}`}
                        aria-hidden='true'>
                        <XCircleIcon size={20} weight='fill' />
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <div className={styles.actions}>
                <ButtonAtom
                  direction='forward'
                  variant='danger'
                  size='lg'
                  className={`${styles.fullWidth} haptic-press`}
                  onClick={() => setStep('confirm')}>
                  {t('wantDeleteBtn')}
                </ButtonAtom>
                <ButtonAtom
                  variant='outlined'
                  size='lg'
                  className={styles.fullWidth}
                  onClick={() => nav.back()}>
                  {t('cancel')}
                </ButtonAtom>
              </div>
            </div>
          }
          aside={
            <DeleteSelfNoteAtom
              title={t('graceTitle')}
              description={t('graceDesc')}
            />
          }
        />
      </div>
    );
  }

  /* ── Step 3: Email sent ── */
  if (step === 'done') {
    return (
      <div className={styles.page}>
        {header}

        <PageColumnsMolecule
          main={
            <div className={styles.column}>
              <DeleteSelfNoteAtom
                title={t('emailSentDesc')}
                description={t('emailSentHint')}
              />
              <div className={styles.actions}>
                <ButtonAtom
                  variant='outlined'
                  size='lg'
                  className={styles.fullWidth}
                  onClick={() => nav.back()}>
                  {t('backToAccount')}
                </ButtonAtom>
              </div>
            </div>
          }
          aside={
            <DeleteSelfNoteAtom
              title={t('graceAfterTitle')}
              description={t('graceAfterDesc')}
            />
          }
        />
      </div>
    );
  }

  /* ── Step 2: Confirmation (type-to-confirm gate) ── */
  return (
    <div className={styles.page}>
      {header}

      <PageColumnsMolecule
        main={
          <div className={styles.column}>
            <section className={styles.card}>
              <InputAtom
                label={t('confirmLabel', { word: CONFIRMATION_WORD })}
                placeholder={t('inputPlaceholder', { word: CONFIRMATION_WORD })}
                value={confirmText}
                onChange={e => {
                  setConfirmText(e.target.value.toUpperCase());
                  if (isError) {
                    resetRequest();
                  }
                }}
                onKeyDown={e => {
                  // Enter with the word typed sends, like the button next to it.
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    handleRequestDelete();
                  }
                }}
                disabled={isPending}
                autoComplete='off'
                autoCorrect='off'
                spellCheck={false}
                enterKeyHint='send'
                className={styles.confirmInput}
              />
              {/* Always mounted: the line keeps its height, so nothing under
                  the field moves when the typed word starts to match. */}
              <p
                className={styles.confirmMatchHint}
                data-visible={isConfirmed || undefined}
                aria-live='polite'>
                {isConfirmed && (
                  <>
                    <span className={styles.lineIcon} aria-hidden='true'>
                      <CheckIcon size={16} weight='bold' />
                    </span>
                    <span>{t('confirmMatch')}</span>
                  </>
                )}
              </p>
            </section>

            <div className={styles.actions}>
              {isError && (
                <p className={styles.actionError} role='alert'>
                  <span
                    className={`${styles.lineIcon} ${styles.dangerIcon}`}
                    aria-hidden='true'>
                    <XCircleIcon size={20} weight='fill' />
                  </span>
                  <span>{t('sendError')}</span>
                </p>
              )}
              <ButtonAtom
                variant='danger'
                size='lg'
                className={`${styles.fullWidth} haptic-press`}
                disabled={!isConfirmed || isPending}
                aria-busy={isPending}
                onClick={handleRequestDelete}>
                {isPending
                  ? t('sending')
                  : isError
                    ? t('retry')
                    : t('sendEmailBtn')}
              </ButtonAtom>
              <ButtonAtom
                variant='outlined'
                size='lg'
                className={styles.fullWidth}
                disabled={isPending}
                onClick={() => {
                  setStep('review');
                  setConfirmText('');
                  resetRequest();
                }}>
                {t('back')}
              </ButtonAtom>
            </div>
          </div>
        }
        aside={
          <DeleteSelfNoteAtom
            title={t('graceAfterTitle')}
            description={t('graceAfterDesc')}
          />
        }
      />
    </div>
  );
}

/* ─── Shell with AppLayout ─── */

export function DeleteSelfPageComposition() {
  const t = useTranslations('pages.deleteSelf');
  return (
    <AppLayoutComposition title={t('title')}>
      <DeleteSelfPageInner />
    </AppLayoutComposition>
  );
}
