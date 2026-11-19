// UI/features/account/components/SessionsTab.organism.tsx
// Section „Bezpieczeństwo”: the devices signed in to the account.
//
// DECISION: the list opens with THIS device, then the five most recent, and keeps the rest behind
// one disclosure; the demo account showed a hundred rows all named "Nieznane" on a 7000px page. A
// row is named by the best fact available (browser and system from the user agent, else the sign-in
// date), never by a placeholder word. (owner)

import { useId, useState } from 'react';
import { SignOutIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { SESSION_DTO_API_V1 } from '@kernel/models/session/session.dto';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { DisclosurePanelAtom } from '../../../components/Disclosure/DisclosurePanel.atom';
import { ErrorStateMolecule } from '../../../components/ErrorState/ErrorState.molecule';
import { SkeletonAtom } from '../../../components/Skeleton/Skeleton.atom';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { AppDialogAtom } from '../../../primitives/AppDialog.atom';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { useSessions } from '../hooks/useSessions';
import {
  useDeleteSessionExactly,
  useDeleteAllSessions,
} from '../hooks/useDeleteSession';
import { SessionRowMolecule } from './SessionRow.molecule';
import styles from './SessionsTab.module.css';

// DECISION: the frontend has NO access to the session token (the server strips it from the GET_ALL
// response). The current session is identified by the server-computed `is_current` flag, and the
// identifier for DELETE_EXACTLY is `session.id` (the DB PK). The bearer token exists only in one
// device's storage + the Authorization header, never in the client-side state of the session list.
type SafeSession =
  SESSION_DTO_API_V1['SESSION_GET_ALL']['RESPONSE']['sessions'][number];

/** Other devices shown before the disclosure. */
const RECENT_VISIBLE = 5;

const toTime = (value: Date | string): number => new Date(value).getTime();

export function SessionsTabOrganism() {
  const t = useTranslations('account.sessions');
  const tButtons = useTranslations('buttons');
  const { data, isLoading, isError, isFetching, refetch } = useSessions();
  const sessions = data?.sessions;
  const deleteExactly = useDeleteSessionExactly();
  const deleteAll = useDeleteAllSessions();
  const [isRestOpen, setIsRestOpen] = useState(false);
  const [isLogoutAllOpen, setIsLogoutAllOpen] = useState(false);
  const restId = useId();

  if (isLoading) {
    return (
      <section
        data-app-section='bordered'
        className={styles.section}
        aria-busy='true'>
        <SkeletonAtom variant='rect' width='60%' height={24} />
        <SkeletonAtom variant='rect' width='100%' height={40} />
        <SkeletonAtom variant='rect' width='100%' height={64} />
        <SkeletonAtom variant='rect' width='100%' height={64} />
        <SkeletonAtom variant='rect' width='100%' height={64} />
      </section>
    );
  }

  // Full error ONLY without data: TanStack keeps the list in cache after a failed background
  // refresh, and that list is still truer than nothing.
  if (!sessions) {
    return (
      <section data-app-section='bordered' className={styles.section}>
        <ErrorStateMolecule
          message={t('loadError')}
          retryLabel={tButtons('retry')}
          onRetry={() => void refetch()}
          isRetrying={isFetching}
        />
      </section>
    );
  }

  const handleDeleteExactly = (id: string) => {
    deleteExactly.mutate(
      { id },
      {
        // DECISION: no local toast either way. The HTTP interceptor toasts the response event
        // (SESSION_DELETED_EXACTLY on success, the error event on failure); a local push of the same
        // event only repeated it.
      }
    );
  };

  // DECISION: SESSION_DELETE_ALL deletes EVERY session of the account, the current one included
  // (backend: `deleteMany({ where: { userId } })`); the API has no "log out the others". The button
  // used to say "Wyloguj wszystkie inne sesje" and also logged this device out. The label now tells
  // the truth and the action asks for confirmation. Do NOT fake "the others" with a loop over
  // DELETE_EXACTLY (up to 99 requests, partial failures): that is a backend change.
  const handleDeleteAll = () => {
    deleteAll.mutate(undefined, {
      // DECISION: same as handleDeleteExactly (the error toast is the HTTP interceptor's; a local
      // CANNOT_DELETE_SESSIONS push was removed as a duplicate).
      onSuccess: () => {
        setIsLogoutAllOpen(false);
        // The hook declares successFeedback 'screen': the backend answers USER_LOGGED_OUT
        // („Wylogowałaś się”), this sentence says it happened on every device.
        pushNewSnackbar(
          APP_EVENTS.INFO.SESSION.ALL_SESSIONS_DELETED,
          'success'
        );
      },
      onError: () => {
        setIsLogoutAllOpen(false);
      },
    });
  };

  const current = sessions.filter(s => s.is_current);
  const others = sessions
    .filter(s => !s.is_current)
    .sort((a, b) => toTime(b.createdAt) - toTime(a.createdAt));
  const recent = others.slice(0, RECENT_VISIBLE);
  const rest = others.slice(RECENT_VISIBLE);

  // Spinner only on the row being logged out (mutation variables), not on every row at once.
  // The other rows' buttons are disabled meanwhile: one mutation, one success callback.
  const deletingSessionId = deleteExactly.isPending
    ? (deleteExactly.variables?.id ?? null)
    : null;
  const rowActionsLocked = deleteExactly.isPending || deleteAll.isPending;

  const renderRow = (session: SafeSession) => (
    <SessionRowMolecule
      key={session.id}
      session={session}
      isDeleting={deletingSessionId === session.id}
      actionsLocked={rowActionsLocked}
      onLogout={handleDeleteExactly}
    />
  );

  return (
    <section data-app-section='bordered' className={styles.section}>
      <div className={styles.head}>
        {/* Count in the title (owner): shows at a glance how many devices have a live session
         * (the query returns only unexpired ones). */}
        <TypographyAtom
          variant='h4'
          className={styles.title}
          data-app-section-title=''>
          {t.rich('devicesTitleWithCount', {
            count: sessions.length,
            num: chunks => <span className='data-count'>{chunks}</span>,
          })}
        </TypographyAtom>
        <ButtonAtom
          variant='outlined'
          size='sm'
          icon={<SignOutIcon size={16} />}
          disabled={rowActionsLocked}
          onClick={() => setIsLogoutAllOpen(true)}>
          {t('logoutAllBtn')}
        </ButtonAtom>
      </div>

      {isError && (
        <div className={styles.staleNotice} role='status'>
          <span>{t('refreshError')}</span>
          <ButtonAtom
            variant='text'
            size='sm'
            disabled={isFetching}
            onClick={() => void refetch()}>
            {tButtons('retry')}
          </ButtonAtom>
        </div>
      )}

      <ul className={styles.list}>
        {current.map(renderRow)}
        {recent.map(renderRow)}
      </ul>

      {rest.length > 0 && (
        <>
          <DisclosurePanelAtom id={restId} open={isRestOpen}>
            <ul className={styles.list}>{rest.map(renderRow)}</ul>
          </DisclosurePanelAtom>
          <ButtonAtom
            variant='outlined'
            size='sm'
            className={styles.restToggle}
            aria-expanded={isRestOpen}
            aria-controls={restId}
            onClick={() => setIsRestOpen(open => !open)}>
            {isRestOpen ? t('hideRest') : t('showRest', { count: rest.length })}
          </ButtonAtom>
        </>
      )}

      <AppDialogAtom
        open={isLogoutAllOpen}
        onOpenChange={open => {
          if (!deleteAll.isPending && !open) {
            setIsLogoutAllOpen(false);
          }
        }}
        disablePointerDismissal={deleteAll.isPending}>
        <AppDialogAtom.Content
          title={t('logoutAllDialogTitle')}
          description={t('logoutAllDialogBody')}>
          <AppDialogAtom.Actions>
            <ButtonAtom
              variant='ghost'
              size='lg'
              onClick={() => setIsLogoutAllOpen(false)}
              disabled={deleteAll.isPending}>
              {tButtons('cancel')}
            </ButtonAtom>
            <ButtonAtom
              variant='danger'
              size='lg'
              icon={<SignOutIcon size={16} />}
              onClick={handleDeleteAll}
              loading={deleteAll.isPending}
              className='press-feedback'>
              {t('logoutAllDialogConfirm')}
            </ButtonAtom>
          </AppDialogAtom.Actions>
        </AppDialogAtom.Content>
      </AppDialogAtom>
    </section>
  );
}
