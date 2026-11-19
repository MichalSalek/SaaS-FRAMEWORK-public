import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
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
   *  `false` on failure — the modal closes ONLY on a confirmed result. */
  onCreateSession: (stylistId: string) => Promise<boolean>;
  /** Show the empty-state CTA to navigate to pairing */
  onNavigateToPairing?: () => void;
  /** How many shared sessions the client may hold at once, set when she has
   *  reached it. The backend refuses a new session then, so the modal says
   *  so up front instead of letting her pick a stylist and fail. */
  sharedLimitReached?: number | undefined;
}

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
  sharedLimitReached,
}: CreateSessionModalProps) {
  const t = useTranslations('createSession');
  const tButtons = useTranslations('buttons');

  const [submitting, setSubmitting] = useState(false);
  // Which stylist the in-flight create is for — the „creating" status belongs
  // to that row only, not to every row of the list.
  const [pendingStylistId, setPendingStylistId] = useState<string | null>(null);
  // Every opening starts with the chooser; no success timer delays navigation.
  useEffect(() => {
    if (open) {
      setSubmitting(false);
      setPendingStylistId(null);
    }
  }, [open]);

  // Failed creates retain the chooser. Only the confirmed saved session closes it.
  async function handlePickStylist(stylistId: string) {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setPendingStylistId(stylistId);
    const created = await onCreateSession(stylistId).catch(() => false);
    setPendingStylistId(null);
    if (!created) {
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    onClose();
  }

  const openSession = (sessionId: string): void => {
    onClose();
    onOpenSession?.(sessionId);
  };

  const atLimit = sharedLimitReached !== undefined;
  // A stylist reached through a salon takes no slot, so she stays pickable at
  // the limit; only when nobody is left to choose does the title state it.
  const canStillCreate = stylists.some(
    s => !s.hasActiveSession && s.outsideLimit === true
  );
  const blockedByLimit = atLimit && !canStillCreate;
  // Blocked by the limit there is nothing to choose: the title states the fact
  // and the rows below lead into the sessions that can be closed.
  const title = blockedByLimit
    ? t('limitTitle', { limit: sharedLimitReached })
    : t('title');

  return (
    // DECISION: while a session is being created the modal cannot be closed (backdrop, ESC,
    // gesture, "Anuluj"). Success navigates to the new session anyway, so closing mid-flight ended
    // in "I closed it and something still moved me"; a failure leaves the modal open for a retry.
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
            {stylistsStatus === 'loading' && (
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

            {stylistsStatus === 'error' && (
              <ErrorStateMolecule
                message={t('stylistsLoadError')}
                {...(onRetryStylists !== undefined && {
                  retryLabel: tButtons('retry'),
                  onRetry: onRetryStylists,
                  isRetrying: isRetryingStylists,
                })}
              />
            )}

            {stylistsStatus === 'ready' && (
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
                  <>
                    {blockedByLimit && (
                      <TypographyAtom variant='body2'>
                        {t('limitBody')}
                      </TypographyAtom>
                    )}
                    <StylistPickRowsMolecule
                      stylists={stylists}
                      submitting={submitting}
                      pendingStylistId={pendingStylistId}
                      atLimit={atLimit}
                      blockedByLimit={blockedByLimit}
                      onPick={stylistId => void handlePickStylist(stylistId)}
                      {...(onOpenSession !== undefined && {
                        onOpenSession: openSession,
                      })}
                    />
                  </>
                )}
              </div>
            )}
          </div>
        </AppDialogAtom.Body>
      </AppDialogAtom.Content>
    </AppDialogAtom>
  );
}
