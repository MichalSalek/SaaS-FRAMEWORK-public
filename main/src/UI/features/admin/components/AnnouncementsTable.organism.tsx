// admin/components/AnnouncementsTable.organism.tsx
// The list of announcements: a table from 768px of its own width, a card per
// row below. Tapping a row edits it; the row menu holds preview, edit, delete.

import type { MouseEvent, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { DataTableOrganism } from '../../../components/DataTable/DataTable.organism';
import type {
  DataTableColumn,
  DataTableError,
} from '../../../components/DataTable/DataTable.organism';
import { StatusPillAtom } from '../../../components/StatusPill/StatusPill.atom';
import { AppMenuAtom } from '../../../primitives/AppMenu.atom';
import type { AdminAnnouncement } from '../hooks/useAdminAnnouncements';
import {
  ANNOUNCEMENT_STATUS_LABEL_KEY,
  ANNOUNCEMENT_TYPE_LABEL_KEY,
  deriveStatus,
  formatAnnouncementWindow,
  getAnnouncementStatusColor,
  getAnnouncementTypeColor,
} from './announcement-status.helpers';
import styles from '../AdminAnnouncementsPage.module.css';

interface AnnouncementsTableProps {
  announcements: readonly AdminAnnouncement[];
  state: 'ready' | 'loading' | 'empty' | 'error';
  /** Shown when the chosen status has no announcements. */
  empty: ReactNode;
  error: DataTableError;
  onPreview: (announcement: AdminAnnouncement) => void;
  onEdit: (announcement: AdminAnnouncement) => void;
  onDelete: (announcement: AdminAnnouncement) => void;
}

export function AnnouncementsTableOrganism({
  announcements,
  state,
  empty,
  error,
  onPreview,
  onEdit,
  onDelete,
}: AnnouncementsTableProps) {
  const t = useTranslations('admin.announcements');

  // A menu item lives in a portal, but its click still bubbles through the
  // React tree to the row: without this the row's own action (edit) would run
  // after every menu choice.
  const menuAction =
    (
      action: (announcement: AdminAnnouncement) => void,
      row: AdminAnnouncement
    ) =>
    (event: MouseEvent<HTMLElement>) => {
      event.stopPropagation();
      action(row);
    };

  const columns: DataTableColumn<AdminAnnouncement>[] = [
    {
      id: 'title',
      header: t('columnTitle'),
      priority: 'primary',
      width: 'minmax(0, 1.4fr)',
      cell: row => row.title,
    },
    {
      id: 'message',
      header: t('columnMessage'),
      priority: 'secondary',
      width: 'minmax(0, 2fr)',
      cell: row => (
        <span className={styles.messagePreview} data-truncate='content'>
          {row.message}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('columnStatus'),
      priority: 'meta',
      width: '9rem',
      cell: row => {
        const status = deriveStatus(row);
        return (
          <StatusPillAtom
            color={getAnnouncementStatusColor(status)}
            label={t(ANNOUNCEMENT_STATUS_LABEL_KEY[status])}
          />
        );
      },
    },
    {
      id: 'type',
      header: t('columnType'),
      priority: 'meta',
      width: '8.5rem',
      cell: row => (
        <StatusPillAtom
          color={getAnnouncementTypeColor(row.type)}
          label={t(ANNOUNCEMENT_TYPE_LABEL_KEY[row.type])}
          showDot={false}
        />
      ),
    },
    {
      id: 'window',
      header: t('columnWindow'),
      priority: 'meta',
      width: '13rem',
      cell: row => (
        <span className={styles.window}>
          {formatAnnouncementWindow(row, t)}
        </span>
      ),
    },
    {
      id: 'actions',
      header: t('columnActions'),
      priority: 'meta',
      action: true,
      align: 'end',
      width: '3.5rem',
      cell: row => (
        <span className={styles.rowMenu} data-row-stop=''>
          <AppMenuAtom>
            <AppMenuAtom.MoreTrigger
              label={t('rowMenuAriaLabel', { title: row.title })}
            />
            <AppMenuAtom.Content align='end'>
              <AppMenuAtom.Item onClick={menuAction(onPreview, row)}>
                {t('menuPreview')}
              </AppMenuAtom.Item>
              <AppMenuAtom.Item onClick={menuAction(onEdit, row)}>
                {t('menuEdit')}
              </AppMenuAtom.Item>
              <AppMenuAtom.Item
                tone='danger'
                onClick={menuAction(onDelete, row)}>
                {t('menuDelete')}
              </AppMenuAtom.Item>
            </AppMenuAtom.Content>
          </AppMenuAtom>
        </span>
      ),
    },
  ];

  return (
    <DataTableOrganism
      columns={columns}
      rows={announcements}
      rowKey={row => row.id}
      caption={t('pageTitle')}
      onRowClick={onEdit}
      rowLabel={row => t('editRowAriaLabel', { title: row.title })}
      state={state}
      empty={empty}
      error={error}
      skeletonRows={4}
    />
  );
}
