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
  // The confirmation word is per language (PL „USUN", EN „DELETE", DE „LÖSCHEN"): a „USUN" literal
  // made EN/DE users retype a foreign word.
  const CONFIRMATION_WORD = t('confirmWord');
  const nav = useNativeRouter();
  useAppBarTitle(t('title'));

  const [step, setStep] = useState<DeleteSelfStep>('review');
  const [confirmText, setConfirmText] = useState('');

  // Scroll reset to top on EVERY flow step change. #main-content is the AppLayout scroll container.
  // Canon: OnboardingPage + UploadAssetPage, the same class of multi-step wizard in an inner scroll
  // shell.
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

  // DECISION: a failed submit stays ON the screen (a sentence next to the button, and the button
  // becomes the retry). The only trace used to be a vanishing toast and the screen looked as if
  // nothing happened. (owner)
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
                  className={`${styles.fullWidth} press-feedback`}
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
                className={`${styles.fullWidth} press-feedback`}
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
