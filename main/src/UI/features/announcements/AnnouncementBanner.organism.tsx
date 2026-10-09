// main/src/UI/features/announcements/AnnouncementBanner.tsx
// Public/App announcement banner — shows active admin-created announcements.
// Dismissable per-announcement via localStorage. SSR-safe.

import { useEffect, useState } from 'react';
import { MegaphoneIcon, XIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import {
  getLocalStorage,
  setLocalStorage,
} from '../../../application/client-device-storage/local-storage-adapter/localStorage.adapter';
import { STORAGE_KEYS } from '../../../application/client-device-storage/storage-keys.config';
import {
  useActiveAnnouncements,
  type ActiveAnnouncement,
} from './hooks/useActiveAnnouncements';
import styles from './AnnouncementBanner.module.css';

/* ─── Constants ─── */

const STORAGE_KEY = STORAGE_KEYS.DISMISSED_ANNOUNCEMENTS;

/* ─── localStorage helpers (SSR-safe, fail-soft) ─── */

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
      return new Set(parsed as string[]);
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
    // Storage quota or private-browsing restriction — fail silently.
  }
}

/* ─── Type guard ─── */

function getTypeDataAttr(
  type: ActiveAnnouncement['type']
): 'info' | 'warning' | 'critical' {
  if (type === 'warning' || type === 'critical') {
    return type;
  }
  return 'info';
}

/* ─── Single announcement item ─── */

interface AnnouncementItemProps {
  announcement: ActiveAnnouncement;
  onDismiss: (id: string) => void;
}

function AnnouncementItem({ announcement, onDismiss }: AnnouncementItemProps) {
  const t = useTranslations('announcements');
  const { id, title, message } = announcement;
  const typeAttr = getTypeDataAttr(announcement.type);

  return (
    <div
      className={styles.item}
      data-type={typeAttr}
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
        {title && <span className={styles.title}>{title}</span>}
        <span className={styles.message}>{message}</span>
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

/* ─── AnnouncementBanner ─── */

export function AnnouncementBannerOrganism() {
  const t = useTranslations('announcements');
  const { announcements } = useActiveAnnouncements();

  // Hydration-safe: read localStorage only after mount.
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setDismissed(readDismissed());
    setMounted(true);
  }, []);

  const handleDismiss = (id: string) => {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(id);
      writeDismissed(next);
      return next;
    });
  };

  // SSR: render nothing until mounted (avoids hydration mismatch from localStorage).
  if (!mounted) {
    return null;
  }

  const visible = announcements.filter(a => !dismissed.has(a.id));

  if (visible.length === 0) {
    return null;
  }

  return (
    <div className={styles.banner} aria-label={t('regionLabel')}>
      {visible.map(announcement => (
        <AnnouncementItem
          key={announcement.id}
          announcement={announcement}
          onDismiss={handleDismiss}
        />
      ))}
    </div>
  );
}
