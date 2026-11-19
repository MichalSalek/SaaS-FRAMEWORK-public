import { useState } from 'react';
import Image from 'next/image';
import clsx from 'clsx';
import { UserIcon } from '@phosphor-icons/react';
import styles from './Avatar.module.css';

type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

// `xl` = the preview in the profile-photo editor: there the avatar IS the thing being worked on,
// not a marker beside a row, so 56px did not allow judging the crop.
const SIZE_PX: Record<AvatarSize, number> = { sm: 32, md: 40, lg: 56, xl: 96 };

export interface AvatarProps {
  src?: string | undefined;
  fallbackSrc?: string | undefined;
  name: string;
  size?: AvatarSize;
  className?: string;
  /** Purely decorative avatar (the name is rendered NEXT to it as visible text): alt=''/aria-hidden,
   *  so a screen reader does not read the name twice. */
  decorative?: boolean;
}

const INITIALS_TONES = 4;

/**
 * Deterministic tone for a name, so the same person keeps the same colour on
 * every screen and across reloads. A small string hash, nothing cryptographic.
 */
function getInitialsTone(name: string): number {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 9973;
  }
  return hash % INITIALS_TONES;
}

function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function AvatarAtom({
  src,
  fallbackSrc,
  name,
  size = 'md',
  className,
  decorative = false,
}: AvatarProps) {
  // Failures are remembered PER URL, not as a sticky flag: a boolean survived a
  // `src` change, so after one broken image (a deleted file) a freshly uploaded
  // avatar kept showing the fallback until the component remounted.
  const [failedSources, setFailedSources] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const activeSrc = [src, fallbackSrc].find(
    candidate =>
      typeof candidate === 'string' &&
      candidate.length > 0 &&
      !failedSources.has(candidate)
  );
  const sizePx = SIZE_PX[size];

  // DECISION: without a photo, initials are drawn LOCALLY in token colors. The old
  // api.dicebear.com fallback hardcoded the old palette's hexes (avatars stayed brick after the
  // accent change and the ink disc vanished on dark), sent names in a query string to a third
  // party on every render, and cost a network request per photoless avatar. Tokens are mode-aware.
  if (!activeSrc) {
    return (
      <span
        className={clsx(
          styles.avatar,
          styles[size],
          styles.initials,
          className
        )}
        data-tone={getInitialsTone(name)}
        // role='img': a name on a plain <span> is not exposed by screen
        // readers (aria-label is prohibited on the generic role), so the
        // initials announced nothing where the <img> announced the name.
        role={decorative ? undefined : 'img'}
        aria-hidden={decorative ? 'true' : undefined}
        aria-label={decorative ? undefined : name}>
        {name.trim() ? (
          getInitials(name)
        ) : (
          <UserIcon size={sizePx / 2} aria-hidden='true' />
        )}
      </span>
    );
  }

  return (
    <Image
      className={clsx(styles.avatar, styles[size], className)}
      src={activeSrc}
      alt={decorative ? '' : name}
      aria-hidden={decorative ? 'true' : undefined}
      width={sizePx}
      height={sizePx}
      sizes={`${sizePx}px`}
      onError={() =>
        setFailedSources(previous => new Set([...previous, activeSrc]))
      }
    />
  );
}
