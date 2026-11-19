// UI/features/notes/components/NotesLists.organism.tsx
// The three lists of the notes screen: notes about clients (client card),
// notes of Inspiration Sessions and visit notes. Each row opens the screen the
// note lives on, where it is edited.
//
// DECISION: a session note written by the CLIENT is labelled as hers („Notatka od klientki”). She
// wrote it and she sees it, so the screen's line „Widzisz je tylko Ty” must not be read as covering
// it; every other note on this screen is the stylist's own.

import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { LockKeyIcon, NotePencilIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { PRIVATE_NOTES_CONFIG } from '@kernel/domain/private-notes/private-notes.config';
import type {
  ClientCardNoteDTO,
  ClientImportantNoteDTO,
  PRIVATE_NOTES_DTO_API_V1,
  PrivateNoteClientDTO,
  SessionNoteDTO,
  VisitNoteDTO,
} from '@kernel/models/private-notes/private-notes.dto';
import { buildRoute } from '../../../../application/routing/buildRoute';
import { formatDate } from '../../../../application/date/date.utils';
import { AvatarAtom } from '../../../components/Avatar/Avatar.atom';
import { LinkButtonAtom } from '../../../components/Button/LinkButton.atom';
import { EmptyStateAtom } from '../../../components/EmptyState/EmptyState.atom';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../../components/NavRow/NavRow.molecule';
import { ImportantNoteLineMolecule } from '../../shared/notes/ImportantNoteLine.molecule';
import { keepWhole, noteExcerpt } from '../notes-presentation';
import styles from '../NotesPage.module.css';

type NotesData =
  PRIVATE_NOTES_DTO_API_V1['ACCOUNT_GET_PRIVATE_NOTES']['RESPONSE'];

function useClientName() {
  const t = useTranslations('pages.notes');
  return (client: PrivateNoteClientDTO) =>
    client.name?.trim() || t('unnamedClient');
}

function ClientAvatar({ client }: { client: PrivateNoteClientDTO }) {
  return <AvatarAtom name={client.name?.trim() ?? ''} size='md' decorative />;
}

function NotesSection({
  id,
  title,
  children,
  truncated,
}: {
  id: string;
  title: string;
  children: ReactNode;
  truncated: boolean;
}) {
  const t = useTranslations('pages.notes');
  return (
    <section className={styles.section} aria-labelledby={id}>
      <h2 id={id} className={styles.sectionTitle}>
        {title}
      </h2>
      {children}
      {truncated && (
        <p className={styles.quietLine}>
          {t('truncated', { count: PRIVATE_NOTES_CONFIG.LIST_MAX })}
        </p>
      )}
    </section>
  );
}

function SectionEmpty({ text }: { text: string }) {
  return <p className={styles.sectionEmpty}>{text}</p>;
}

function ClientCardNoteRow({ item }: { item: ClientCardNoteDTO }) {
  const t = useTranslations('pages.notes');
  const locale = useLocale();
  const name = useClientName()(item.client);
  return (
    <NavRowMolecule
      href={buildRoute(ROUTES_FRONT.CLIENT_CARD, {
        id: item.client.client_user_id,
      })}
      leading={<ClientAvatar client={item.client} />}
      label={name}
      description={t('clientNoteChanged', {
        date: keepWhole(formatDate(item.updated_at, locale)),
      })}
      note={noteExcerpt(item.note)}
      trailing='disc'
    />
  );
}

function ImportantNoteRow({ item }: { item: ClientImportantNoteDTO }) {
  const name = useClientName()(item.client);
  return (
    <NavRowMolecule
      href={buildRoute(ROUTES_FRONT.CLIENT_CARD, {
        id: item.client.client_user_id,
      })}
      leading={<ClientAvatar client={item.client} />}
      label={name}
      note={<ImportantNoteLineMolecule note={item.note} variant='inline' />}
      trailing='disc'
    />
  );
}

function SessionNoteRow({ item }: { item: SessionNoteDTO }) {
  const t = useTranslations('pages.notes');
  const locale = useLocale();
  const name = useClientName()(item.client);
  const date = keepWhole(formatDate(item.updated_at, locale));
  return (
    <NavRowMolecule
      href={buildRoute(ROUTES_FRONT.SESSION_DETAIL, {
        sessionId: item.session_id,
      })}
      leading={<ClientAvatar client={item.client} />}
      label={name}
      description={
        item.author === 'CLIENT'
          ? t('sessionNoteByClient', { date })
          : t('sessionNoteByYou', { date })
      }
      note={noteExcerpt(item.note)}
      trailing='disc'
    />
  );
}

function VisitNoteRow({ item }: { item: VisitNoteDTO }) {
  const t = useTranslations('pages.notes');
  const locale = useLocale();
  const name = useClientName()(item.client);
  return (
    <NavRowMolecule
      href={buildRoute(ROUTES_FRONT.CLIENT_CARD, {
        id: item.client.client_user_id,
      })}
      leading={<ClientAvatar client={item.client} />}
      label={name}
      description={t('visitNoteOn', {
        date: keepWhole(formatDate(item.visit_date, locale)),
      })}
      note={noteExcerpt(item.note)}
      trailing='disc'
    />
  );
}

/** Free plan: the two client-card lists are a plan feature, said once. */
function NotesLockedMolecule({
  trialAvailable,
  payHref,
}: {
  trialAvailable: boolean;
  payHref: string;
}) {
  const t = useTranslations('pages.notes');
  return (
    <section className={styles.locked} aria-labelledby='notes-locked-title'>
      <div className={styles.lockedHead}>
        <span className={styles.lockedIcon} aria-hidden='true'>
          <LockKeyIcon size={22} />
        </span>
        <h2 id='notes-locked-title' className={styles.sectionTitle}>
          {t('lockedTitle')}
        </h2>
      </div>
      <p className={styles.lockedBody}>{t('lockedBody')}</p>
      <LinkButtonAtom
        href={payHref}
        variant='outlined'
        size='md'
        className={styles.lockedCta}>
        {trialAvailable ? t('lockedTrialCta') : t('lockedUpgradeCta')}
      </LinkButtonAtom>
    </section>
  );
}

export function NotesListsOrganism({
  data,
  isFiltered,
  trialAvailable,
  payHref,
}: {
  data: NotesData;
  isFiltered: boolean;
  trialAvailable: boolean;
  payHref: string;
}) {
  const t = useTranslations('pages.notes');
  const nothingAtAll =
    !isFiltered &&
    data.important_notes.length === 0 &&
    data.client_notes.length === 0 &&
    data.session_notes.length === 0 &&
    data.visit_notes.length === 0;

  // A stylist with no note anywhere gets ONE state that teaches where notes
  // come from, not three empty boxes in a row.
  if (nothingAtAll && !data.history_locked) {
    return (
      <EmptyStateAtom
        icon={<NotePencilIcon size={32} />}
        title={t('emptyTitle')}
        titleAs='h2'
        description={t('emptyBody')}
        action={
          <LinkButtonAtom
            href={ROUTES_FRONT.CLIENTS}
            variant='outlined'
            size='md'
            direction='forward'>
            {t('emptyCta')}
          </LinkButtonAtom>
        }
        role='status'
      />
    );
  }

  return (
    <>
      {/* DECISION: „Ważne przed wizytą” leads the screen and has no plan gate (safety
          information); the section appears only when at least one client has it. */}
      {data.important_notes.length > 0 && (
        <NotesSection
          id='notes-important'
          title={t('importantNotesTitle')}
          truncated={data.important_notes_truncated}>
          <NavRowListMolecule ariaLabel={t('importantNotesTitle')}>
            {data.important_notes.map(item => (
              <ImportantNoteRow key={item.client.client_user_id} item={item} />
            ))}
          </NavRowListMolecule>
        </NotesSection>
      )}

      {data.history_locked ? (
        <NotesLockedMolecule
          trialAvailable={trialAvailable}
          payHref={payHref}
        />
      ) : (
        <NotesSection
          id='notes-clients'
          title={t('clientNotesTitle')}
          truncated={data.client_notes_truncated}>
          {data.client_notes.length > 0 ? (
            <NavRowListMolecule ariaLabel={t('clientNotesTitle')}>
              {data.client_notes.map(item => (
                <ClientCardNoteRow
                  key={item.client.client_user_id}
                  item={item}
                />
              ))}
            </NavRowListMolecule>
          ) : (
            <SectionEmpty
              text={isFiltered ? t('filteredEmpty') : t('clientNotesEmpty')}
            />
          )}
        </NotesSection>
      )}

      <NotesSection
        id='notes-sessions'
        title={t('sessionNotesTitle')}
        truncated={data.session_notes_truncated}>
        {data.session_notes.length > 0 ? (
          <NavRowListMolecule ariaLabel={t('sessionNotesTitle')}>
            {data.session_notes.map(item => (
              <SessionNoteRow
                key={`${item.session_id}:${item.author}`}
                item={item}
              />
            ))}
          </NavRowListMolecule>
        ) : (
          <SectionEmpty
            text={isFiltered ? t('filteredEmpty') : t('sessionNotesEmpty')}
          />
        )}
      </NotesSection>

      {!data.history_locked && (
        <NotesSection
          id='notes-visits'
          title={t('visitNotesTitle')}
          truncated={data.visit_notes_truncated}>
          {data.visit_notes.length > 0 ? (
            <NavRowListMolecule ariaLabel={t('visitNotesTitle')}>
              {data.visit_notes.map(item => (
                <VisitNoteRow key={item.visit_id} item={item} />
              ))}
            </NavRowListMolecule>
          ) : (
            <SectionEmpty
              text={isFiltered ? t('filteredEmpty') : t('visitNotesEmpty')}
            />
          )}
        </NotesSection>
      )}
    </>
  );
}
