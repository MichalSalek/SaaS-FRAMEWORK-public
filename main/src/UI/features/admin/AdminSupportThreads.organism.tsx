// UI/features/admin/AdminSupportThreads.organism.tsx
// The support queue on the shared table: from 768px of its own width a real
// table, below it one card per thread. The person and the subject stand first
// and are never cut; the whole row is a link to the thread.

import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChatCircleDotsIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT_APP } from '@kernel/domain/routing/routing.config';
import type { SupportThreadAdminListItem } from '@kernel/models/support/support.dto';
import { buildRoute } from '../../../application/routing/buildRoute';
import {
  DataTableOrganism,
  type DataTableColumn,
  type DataTableError,
} from '../../components/DataTable/DataTable.organism';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { SupportStatusBadgeMolecule } from './components/SupportStatusBadge.molecule';
import { SoftBreakTextAtom } from '../../components/SoftBreakText/SoftBreakText.atom';
import styles from './AdminSupportPage.module.css';

type Translate = ReturnType<typeof useTranslations>;

function formatRelative(
  value: string | Date,
  t: Translate,
  locale: string
): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) {
    return t('relativeNow');
  }
  if (diffMin < 60) {
    return t('relativeMin', { count: diffMin });
  }
  if (diffHours < 24) {
    return t('relativeHr', { count: diffHours });
  }
  if (diffDays < 7) {
    return t('relativeDay', { count: diffDays });
  }
  // DECISION (nie usuwaj tego komentarza):
  // Bez `locale` toLocaleDateString() brał domyślny locale runtime (en-US →
  // „7/8/2026") na polskiej liście zgłoszeń starszych niż 7 dni. Przekazujemy
  // aktywny locale → PL „8.07.2026", DE „8.7.2026".
  return d.toLocaleDateString(locale);
}

// Konto usunięte albo przeniesione po 90 dniach (soft-FK) oddaje puste imię i
// e-mail; bez fallbacku wiersz miał pustego nadawcę i „od " w etykiecie.
const personOf = (thread: SupportThreadAdminListItem, fallback: string) => {
  const name = thread.user_name.trim();
  const email = thread.user_email.trim();
  return {
    name: name.length > 0 ? name : email.length > 0 ? email : fallback,
    // The address is its own quiet line only when it is not already the name.
    email: name.length > 0 && email.length > 0 ? email : null,
  };
};

// DECISION (nie usuwaj tego komentarza) — przegląd S126: podgląd ma DODAWAĆ
// informację. Temat wątku serwer wylicza z pierwszej wiadomości, więc przy
// jednej wiadomości podgląd powtarzał temat słowo w słowo: wtedy go nie ma.
// Prefiks „Użytkownik:” też zniknął (status mówi, kto czeka); zostaje tylko
// „Ty:”, gdy ostatnia wiadomość jest nasza.
const previewOf = (thread: SupportThreadAdminListItem): string | null => {
  const preview = thread.last_message_preview?.trim() ?? '';
  if (preview.length === 0) {
    return null;
  }
  const subject = thread.subject.trim().replace(/(\.{3}|…)$/, '');
  return subject.length > 0 && preview.startsWith(subject) ? null : preview;
};

export function AdminSupportThreadsOrganism({
  threads,
  state,
  error,
  showStaleError,
  empty,
  footer,
}: {
  threads: readonly SupportThreadAdminListItem[];
  state: 'ready' | 'loading' | 'empty' | 'error';
  error: DataTableError;
  /** A later read failed while rows are on screen: the retry stands above them. */
  showStaleError: boolean;
  empty: { title: string; description: string };
  /** Pager and „search older”; null when there is nothing to page through. */
  footer: ReactNode | null;
}) {
  const t = useTranslations('admin.support');
  const tCategory = useTranslations('pages.support.categories');
  const locale = useLocale();

  const columns: DataTableColumn<SupportThreadAdminListItem>[] = [
    {
      id: 'person',
      header: t('columnPerson'),
      priority: 'primary',
      // The widest track: a name with a long address under it.
      width: 'minmax(0, 1.2fr)',
      cell: thread => {
        const person = personOf(thread, t('userFallbackName'));
        return (
          <>
            {person.name}
            {person.email !== null && (
              <SoftBreakTextAtom className={styles.cellQuiet}>
                {person.email}
              </SoftBreakTextAtom>
            )}
          </>
        );
      },
    },
    {
      id: 'subject',
      header: t('columnSubject'),
      priority: 'primary',
      width: 'minmax(0, 1fr)',
      cell: thread => {
        const preview = previewOf(thread);
        return (
          <>
            {thread.subject}
            {/* One quiet line: the category (threads from before categories
                have none) and how long the conversation is. */}
            <span className={styles.cellQuiet}>
              {thread.category !== null && `${tCategory(thread.category)}, `}
              <span className={styles.nowrap}>
                {t('heroPillMessages', { count: thread.message_count })}
              </span>
            </span>
            {preview !== null && (
              // A message a person wrote: two lines of it, on purpose.
              <span className={styles.preview} data-truncate='content'>
                {thread.last_message_sender_type === 'SUPPORT' && (
                  <span className={styles.previewLabel}>
                    {t('previewFromSupport')}{' '}
                  </span>
                )}
                {preview}
              </span>
            )}
          </>
        );
      },
    },
    {
      id: 'status',
      header: t('columnStatus'),
      priority: 'meta',
      // Fits the longest status („Czeka na odpowiedź” / „Wartet auf Antwort”).
      width: '11.5rem',
      cell: thread => (
        <SupportStatusBadgeMolecule
          status={thread.status}
          awaitingReply={
            thread.status === 'OPEN' &&
            thread.last_message_sender_type === 'USER'
          }
          t={t}
        />
      ),
    },
    {
      id: 'activity',
      header: t('columnActivity'),
      priority: 'meta',
      width: '9rem',
      cell: thread => (
        <span className={styles.nowrap}>
          {formatRelative(thread.updated_at, t, locale)}
        </span>
      ),
    },
  ];

  return (
    <>
      {showStaleError && <ErrorStateMolecule {...error} />}
      <DataTableOrganism
        caption={t('heroTitle')}
        columns={columns}
        rows={threads}
        rowKey={thread => thread.id}
        rowHref={thread =>
          buildRoute(ROUTES_FRONT_APP.ADMIN_SUPPORT_THREAD, {
            threadId: thread.id,
          })
        }
        rowLabel={thread =>
          t('rowAriaLabel', {
            subject: thread.subject,
            name: personOf(thread, t('userFallbackName')).name,
          })
        }
        state={state}
        error={error}
        empty={
          <EmptyStateAtom
            icon={<ChatCircleDotsIcon size={24} weight='regular' />}
            title={empty.title}
            titleAs='h2'
            description={empty.description}
          />
        }
        {...(footer !== null && { footer })}
      />
    </>
  );
}
