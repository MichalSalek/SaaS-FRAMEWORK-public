// UI/features/account/components/SessionsTab.organism.tsx
// Section „Bezpieczeństwo”: the devices signed in to the account.
//
// DECISION (nie usuwaj tego komentarza) — owner 2026-10-08:
// the demo account showed a hundred rows, all named „Nieznane”, on a 7000px
// page. The list now opens with THIS device, then the five most recent, and
// keeps the rest behind one disclosure. A row is named by the best fact we
// have (browser and system from the user agent, else the sign-in date), never
// by a placeholder word.

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

// DECISION (nie usuwaj tego komentarza):
// Frontend NIE ma dostepu do tokenu sesji (server strippuje token z GET_ALL response).
// Identyfikacja biezacej sesji via server-computed `is_current` flag. Identifier
// dla DELETE_EXACTLY = `session.id` (DB PK). Token bearera istnieje tylko w storage
// jednego device + Authorization header — nie w client-side state lista sesji.
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
      <section className={styles.section} aria-busy='true'>
        <SkeletonAtom variant='rect' width='60%' height={24} />
        <SkeletonAtom variant='rect' width='100%' height={40} />
        <SkeletonAtom variant='rect' width='100%' height={64} />
        <SkeletonAtom variant='rect' width='100%' height={64} />
        <SkeletonAtom variant='rect' width='100%' height={64} />
      </section>
    );
  }

  // Pełny błąd TYLKO bez danych: TanStack zostawia listę w cache przy
  // nieudanym odświeżeniu w tle, a ta lista jest nadal prawdziwsza niż nic.
  if (!sessions) {
    return (
      <section className={styles.section}>
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
        // DECISION (nie usuwaj tego komentarza):
        // BRAK lokalnego onError celowo. Toast błędu należy do interceptora HTTP
        // (event-bus Stage 1) — dla każdej nieudanej mutacji pushuje konkretny event
        // backendu lub INTERNET_CONNECTION_PROBLEM przy sieci/timeoucie. Wcześniejszy
        // lokalny push CANNOT_DELETE_SESSION (event frontend-only, mapper backendu go
        // NIE emituje) zawsze DUBLOWAŁ toast interceptora (inny klucz eventu → dedup
        // po deduplikacji message nigdy nie zadziała) → usunięty.
        onSuccess: () => {
          pushNewSnackbar(
            APP_EVENTS.INFO.SESSION.SESSION_DELETED_EXACTLY,
            'success'
          );
        },
      }
    );
  };

  // DECISION (nie usuwaj tego komentarza) — 2026-10-08:
  // SESSION_DELETE_ALL kasuje KAŻDĄ sesję konta, razem z bieżącą (backend:
  // `deleteMany({ where: { userId } })`); punktu „wyloguj pozostałe” API nie
  // ma. Przycisk nazywał się „Wyloguj wszystkie inne sesje” i wylogowywał też
  // to urządzenie. Etykieta mówi teraz prawdę, a akcja pyta o potwierdzenie.
  // NIE udawać „pozostałych” pętlą po DELETE_EXACTLY (do 99 żądań, częściowe
  // porażki): to zmiana po stronie backendu.
  const handleDeleteAll = () => {
    deleteAll.mutate(undefined, {
      // DECISION: patrz handleDeleteExactly — toast błędu = interceptor HTTP,
      // lokalny push CANNOT_DELETE_SESSIONS (frontend-only) usunięty jako duplikat.
      onSuccess: () => {
        setIsLogoutAllOpen(false);
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

  // Spinner tylko na wierszu, którego dotyczy wylogowanie (zmienne mutacji),
  // a nie na każdym wierszu naraz. Przyciski pozostałych wierszy są w tym
  // czasie wyłączone: jedna mutacja, jeden callback sukcesu.
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
    <section className={styles.section}>
      <div className={styles.head}>
        {/* Licznik w tytule (owner 2026-07-11) — od razu widać ile urządzeń
         * ma żywą sesję (query zwraca już tylko nieprzeterminowane). */}
        <TypographyAtom variant='h4' className={styles.title}>
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
              className='haptic-press'>
              {t('logoutAllDialogConfirm')}
            </ButtonAtom>
          </AppDialogAtom.Actions>
        </AppDialogAtom.Content>
      </AppDialogAtom>
    </section>
  );
}
