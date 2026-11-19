import { UserIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import type { MessagingThreadMeta } from '@kernel/models/messaging/messaging.dto';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';
import styles from './MessagingCounterpart.module.css';

type ViewerSide = MessagingThreadMeta['viewer_side'] | null;

/** The inbox mixes both roles; each conversation's metadata identifies the viewer's side. */
export function useCounterpartLabel(name: string, viewerSide: ViewerSide) {
  const t = useTranslations('pages.messaging');
  return (
    name.trim() ||
    (viewerSide === 'STYLIST'
      ? t('unnamedClient')
      : viewerSide === 'CLIENT'
        ? t('unnamedStylist')
        : t('unnamedPerson'))
  );
}

/** Never turn a fallback label into initials or reveal a photo for a nameless row. */
export function MessagingCounterpartAvatarMolecule({
  name,
  avatarUrl,
  size,
}: {
  name: string;
  avatarUrl: string | null;
  size: 'sm' | 'md';
}) {
  const actualName = name.trim();
  return actualName ? (
    <AvatarAtom
      src={avatarUrl ?? undefined}
      name={actualName}
      size={size}
      decorative
    />
  ) : (
    <span
      className={`${styles.neutralAvatar} ${styles[size]}`}
      aria-hidden='true'>
      <UserIcon size={size === 'sm' ? 16 : 18} />
    </span>
  );
}
