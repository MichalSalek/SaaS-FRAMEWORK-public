import { useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircleIcon } from '@phosphor-icons/react';
import { TypographyAtom } from '../Typography/Typography.atom';
import { ButtonAtom } from '../Button/Button.atom';
import { SkeletonAtom } from '../Skeleton/Skeleton.atom';
import { ErrorStateMolecule } from '../ErrorState/ErrorState.molecule';
import { AppDialogAtom } from '../../primitives/AppDialog.atom';
import { StylistPickRowsMolecule } from './CreateSessionModal.rows.molecule';
import type { StylistOption, StylistsStatus } from './CreateSessionModal.types';
import styles from './CreateSessionModal.module.css';

/* ─── Types ─── */

export type { StylistOption, StylistsStatus };
export { resolveStylistsStatus } from './CreateSessionModal.types';

export interface CreateSessionModalProps {
  open: boolean;
  onClose: () => void;
  /** List of paired stylists to choose from */
  stylists: StylistOption[];
  /** Defaults to `ready` (the list is authoritative). */
  stylistsStatus?: StylistsStatus;
  /** Retry for `stylistsStatus === 'error'` (typically the query's refetch). */
  onRetryStylists?: () => void;
  /** A retry via `onRetryStylists` is in flight (typically the query's `isFetching`). */
  isRetryingStylists?: boolean;
  /** Opens an existing session (blocked rows with a known `activeSessionId`). */
  onOpenSession?: (sessionId: string) => void;
  /** Create the session with the chosen stylist. Resolves `true` on success,
   *  `false` on failure — the modal advances to the success step ONLY on `true`. */
  onCreateSession: (stylistId: string) => Promise<boolean>;
  /** Show the empty-state CTA to navigate to pairing */
  onNavigateToPairing?: () => void;
}

type Step = 'pick-stylist' | 'done';

/** Ile trwa ekran sukcesu, zanim modal zamknie się sam. */
const SUCCESS_AUTO_CLOSE_MS = 1200;

/* ─── Component ─── */

export function CreateSessionModalOrganism({
  open,
  onClose,
  stylists,
  stylistsStatus = 'ready',
  onRetryStylists,
  isRetryingStylists,
  onOpenSession,
  onCreateSession,
  onNavigateToPairing,
}: CreateSessionModalProps) {
  const t = useTranslations('createSession');
  const tButtons = useTranslations('buttons');
  const [step, setStep] = useState<Step>('pick-stylist');

  const [submitting, setSubmitting] = useState(false);
  // Which stylist the in-flight create is for — the „creating" status belongs
  // to that row only, not to every row of the list.
  const [pendingStylistId, setPendingStylistId] = useState<string | null>(null);
  // Uchwyt na opóźnione auto-zamknięcie ekranu sukcesu — bez niego zamknięcie
  // modala ręcznie w trakcie tych 1,2 s wołało `onClose` po raz drugi już po
  // zamknięciu (a po odmontowaniu — na nieistniejącym widoku).
  const autoCloseTimer = useRef<number | null>(null);

  const cancelAutoClose = (): void => {
    if (autoCloseTimer.current !== null) {
      window.clearTimeout(autoCloseTimer.current);
      autoCloseTimer.current = null;
    }
  };

  // Reset step whenever the modal opens.
  useEffect(() => {
    if (open) {
      cancelAutoClose();
      setStep('pick-stylist');
      setSubmitting(false);
      setPendingStylistId(null);
    }
  }, [open]);

  useEffect(() => cancelAutoClose, []);

  // Advance to the 'done' success step ONLY after the create mutation resolves
  // successfully. On failure the interceptor already toasted the backend error —
  // stay on the pick step (no fake success flash, no auto-close). The
  // `submitting` guard blocks a second pick while the first is in flight.
  async function handlePickStylist(stylistId: string) {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setPendingStylistId(stylistId);
    const created = await onCreateSession(stylistId);
    setPendingStylistId(null);
    if (!created) {
      setSubmitting(false);
      return;
    }
    setStep('done');
    cancelAutoClose();
    autoCloseTimer.current = window.setTimeout(() => {
      autoCloseTimer.current = null;
      onClose();
    }, SUCCESS_AUTO_CLOSE_MS);
  }

  const openSession = (sessionId: string): void => {
    onClose();
    onOpenSession?.(sessionId);
  };

  const title = step === 'done' ? t('titleDone') : t('title');

  return (
    // DECISION (nie usuwaj tego komentarza): w trakcie tworzenia sesji modal
    // NIE daje się zamknąć (tło, ESC, gest, „Anuluj"). Sukces i tak nawiguje na
    // detal nowej sesji, więc zamknięcie w locie kończyło się „zamknęłam, a mimo
    // to coś mnie przeniosło"; porażka zostawia modal otwarty do ponowienia.
    <AppDialogAtom
      open={open}
      disablePointerDismissal={submitting}
      onOpenChange={nextOpen => {
        if (!nextOpen && !submitting) {
          onClose();
        }
      }}>
      <AppDialogAtom.Content title={title}>
        <AppDialogAtom.Body>
          <div className={styles.content} aria-busy={submitting}>
            {step !== 'done' && stylistsStatus === 'loading' && (
              <div className={styles.stylistList}>
                {[0, 1].map(i => (
                  <SkeletonAtom
                    key={i}
                    variant='rect'
                    width='100%'
                    height={64}
                  />
                ))}
              </div>
            )}

            {step !== 'done' && stylistsStatus === 'error' && (
              <ErrorStateMolecule
                message={t('stylistsLoadError')}
                {...(onRetryStylists !== undefined && {
                  retryLabel: tButtons('retry'),
                  onRetry: onRetryStylists,
                  isRetrying: isRetryingStylists,
                })}
              />
            )}

            {stylistsStatus === 'ready' && step === 'pick-stylist' && (
              <div className={styles.stylistList}>
                {stylists.length === 0 ? (
                  <div className={styles.emptyPaired}>
                    <TypographyAtom variant='body2'>
                      {t('emptyPaired')}
                    </TypographyAtom>
                    {onNavigateToPairing && (
                      <ButtonAtom
                        variant='primary'
                        size='sm'
                        onClick={() => {
                          onClose();
                          onNavigateToPairing();
                        }}>
                        {t('pairCta')}
                      </ButtonAtom>
                    )}
                  </div>
                ) : (
                  <StylistPickRowsMolecule
                    stylists={stylists}
                    submitting={submitting}
                    pendingStylistId={pendingStylistId}
                    onPick={stylistId => void handlePickStylist(stylistId)}
                    {...(onOpenSession !== undefined && {
                      onOpenSession: openSession,
                    })}
                  />
                )}
              </div>
            )}

            {step === 'done' && (
              <div className={styles.doneStep}>
                <CheckCircleIcon size={48} color='var(--color-success)' />
                <TypographyAtom variant='h4'>
                  {t('sessionCreated')}
                </TypographyAtom>
                <TypographyAtom variant='body2' align='center'>
                  {t('sessionCreatedHint')}
                </TypographyAtom>
              </div>
            )}
          </div>
        </AppDialogAtom.Body>
      </AppDialogAtom.Content>
    </AppDialogAtom>
  );
}
