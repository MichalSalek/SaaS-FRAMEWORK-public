// announcements/AnnouncementBanner.organism.tsx
// One strip per active announcement for this surface and viewer.
// A missing language hides that row. Dismissals live in localStorage.

import { useState } from 'react';
import { MegaphoneIcon, XIcon } from '@phosphor-icons/react';
import { useLocale, useTranslations } from 'next-intl';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import { getLocaleOrDefault } from '@kernel/domain/i18n/i18n.config';
import {
  getLocalStorage,
  setLocalStorage,
} from '../../../application/client-device-storage/local-storage-adapter/localStorage.adapter';
import { STORAGE_KEYS } from '../../../application/client-device-storage/storage-keys.config';
import { useHydrated } from '../../hooks/useHydrated';
import { AnnouncementContentMolecule } from './AnnouncementContent.molecule';
import {
  bannerAnnouncementCopy,
  type AnnouncementSurface,
  type AnnouncementViewer,
} from './announcement-display';
import {
  useActiveAnnouncements,
  type ActiveAnnouncement,
} from './hooks/useActiveAnnouncements';
import styles from './AnnouncementBanner.module.css';

const STORAGE_KEY = STORAGE_KEYS.DISMISSED_ANNOUNCEMENTS;

function readDismissed(): Set<string> {
  try {
    if (typeof window === 'undefined') {
      return new Set();
    }
    const raw = getLocalStorage(STORAGE_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter(item => typeof item === 'string'));
    }
    return new Set();
  } catch {
    return new Set();
  }
}

function writeDismissed(ids: Set<string>): void {
  try {
    if (typeof window === 'undefined') {
      return;
    }
    setLocalStorage(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage quota or private browsing. The strip stays for this view.
  }
}

function getTypeDataAttr(
  type: ActiveAnnouncement['type']
): 'info' | 'warning' | 'critical' {
  if (type === 'warning' || type === 'critical') {
    return type;
  }
  return 'info';
}

function AnnouncementItem({
  id,
  type,
  title,
  message,
  onDismiss,
}: {
  id: string;
  type: ActiveAnnouncement['type'];
  title: string;
  message: string;
  onDismiss: (id: string) => void;
}) {
  const t = useTranslations('announcements');
  return (
    <div
      className={styles.item}
      data-type={getTypeDataAttr(type)}
      role='status'
      aria-live='polite'
      aria-atomic='true'>
      <MegaphoneIcon
        size={16}
        weight='fill'
        className={styles.icon}
        aria-hidden='true'
      />
      <div className={styles.content}>
        {title.length > 0 && <span className={styles.title}>{title}</span>}
        <AnnouncementContentMolecule
          message={message}
          className={styles.message}
        />
      </div>
      <button
        type='button'
        className={styles.dismiss}
        onClick={() => onDismiss(id)}
        aria-label={t('dismiss')}>
        <XIcon size={14} weight='bold' aria-hidden='true' />
      </button>
    </div>
  );
}

function viewerOf(
  isLoggedIn: boolean,
  accountType: string | null
): AnnouncementViewer {
  if (!isLoggedIn) {
    return null;
  }
  if (accountType === AccountTypeValue.STYLIST) {
    return 'STYLIST';
  }
  if (accountType === AccountTypeValue.CLIENT) {
    return 'CLIENT';
  }
  return null;
}

export function AnnouncementBannerOrganism({
  surface,
}: {
  surface: AnnouncementSurface;
}) {
  const t = useTranslations('announcements');
  const locale = getLocaleOrDefault(useLocale());
  const hydrated = useHydrated();
  const { announcements, ready, isLoggedIn, accountType } =
    useActiveAnnouncements(surface);
  const [dismissedOverride, setDismissedOverride] =
    useState<Set<string> | null>(null);
  const dismissed =
    dismissedOverride ?? (hydrated ? readDismissed() : new Set());

  if (!hydrated || !ready) {
    return null;
  }

  const viewer = viewerOf(isLoggedIn, accountType);
  const visible = announcements.flatMap(announcement => {
    if (dismissed.has(announcement.id)) {
      return [];
    }
    const copy = bannerAnnouncementCopy(announcement, locale, viewer, surface);
    if (copy === undefined) {
      return [];
    }
    return [{ announcement, copy }];
  });

  if (visible.length === 0) {
    return null;
  }

  return (
    <div className={styles.banner} aria-label={t('regionLabel')}>
      {visible.map(({ announcement, copy }) => (
        <AnnouncementItem
          key={announcement.id}
          id={announcement.id}
          type={announcement.type}
          title={copy.title}
          message={copy.message}
          onDismiss={id => {
            setDismissedOverride(prev => {
              const next = new Set(prev ?? readDismissed());
              next.add(id);
              writeDismissed(next);
              return next;
            });
          }}
        />
      ))}
    </div>
  );
}
