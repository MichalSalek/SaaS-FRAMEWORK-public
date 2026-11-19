import clsx from 'clsx';
import styles from './Illustration.module.css';

type IllustrationSize = 'sm' | 'md' | 'lg';

export interface IllustrationProps {
  /** Path from the typed asset registry (`LP_ASSETS`), never a string literal. */
  src: string;
  size?: IllustrationSize;
  className?: string;
}

/**
 * Decorative nail-art cutout for app empty states and onboarding.
 * The adjacent text carries the meaning, so assistive technology skips it.
 * DECISION: preserve the original polish colors in every theme; transparent
 * artwork needs no dark-mode inversion or background rectangle. (owner)
 */
export function IllustrationAtom({
  src,
  size = 'md',
  className,
}: IllustrationProps) {
  return (
    <img
      src={src}
      alt=''
      aria-hidden='true'
      loading='lazy'
      decoding='async'
      className={clsx(styles.illustration, styles[size], className)}
    />
  );
}
