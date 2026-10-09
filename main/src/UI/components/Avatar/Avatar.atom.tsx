import { useState } from 'react';
import Image from 'next/image';
import clsx from 'clsx';
import styles from './Avatar.module.css';

type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

// `xl` = podgląd w edytorze zdjęcia profilowego: tam avatar JEST przedmiotem
// pracy, a nie oznaczeniem przy wierszu, więc 56px nie pozwalało ocenić kadru.
const SIZE_PX: Record<AvatarSize, number> = { sm: 32, md: 40, lg: 56, xl: 96 };

export interface AvatarProps {
  src?: string | undefined;
  name: string;
  size?: AvatarSize;
  className?: string;
  /** Avatar czysto dekoracyjny (nazwa renderowana OBOK jako widoczny tekst) —
   *  alt=''/aria-hidden, żeby SR nie czytał nazwy podwójnie (S82). */
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
    // B1-F10: Empty name fallback — return a generic placeholder initial
    // rather than an empty string or '?' so the inline initials slot is legible.
    // Callers should prefer passing display_name or email[0] as `name` instead.
    return '?';
  }
  return trimmed
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function AvatarAtom({
  src,
  name,
  size = 'md',
  className,
  decorative = false,
}: AvatarProps) {
  // Failures are remembered PER URL, not as a sticky flag: a boolean survived a
  // `src` change, so after one broken image (a deleted file) a freshly uploaded
  // avatar kept showing the fallback until the component remounted.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const imgError = src !== undefined && failedSrc === src;
  const sizePx = SIZE_PX[size];

  // DECISION (nie usuwaj tego komentarza) — S126, 2026-10-08:
  // bez zdjęcia rysujemy inicjały LOKALNIE, w kolorach z tokenów. Wcześniej
  // fallbackiem był obrazek z api.dicebear.com: (1) jego tła były wpisanymi na
  // sztywno heksami STAREJ palety, więc po zmianie akcentu na malinowy awatary
  // zostały ceglaste, a atramentowe kółko znikało na ciemnym tle (census S126:
  // „JN”, „KM” niewidoczne w trybie ciemnym); (2) imię i nazwisko leciało
  // w query-stringu do zewnętrznego serwisu przy każdym renderze (dla adresów
  // e-mail istniał już wyjątek, dla imion nie); (3) każdy awatar bez zdjęcia
  // kosztował żądanie sieciowe. Tokeny są mode-aware, więc inicjały czyta się
  // w obu trybach bez osobnej reguły.
  if (!src || imgError) {
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
        {getInitials(name)}
      </span>
    );
  }

  return (
    <Image
      className={clsx(styles.avatar, styles[size], className)}
      src={src}
      alt={decorative ? '' : name}
      aria-hidden={decorative ? 'true' : undefined}
      width={sizePx}
      height={sizePx}
      sizes={`${sizePx}px`}
      onError={() => setFailedSrc(src)}
    />
  );
}
