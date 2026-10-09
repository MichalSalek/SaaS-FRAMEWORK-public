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
 * A line drawing from the asset library placed inside the APP: empty states,
 * success screens, onboarding. Always decorative (the words next to it carry
 * the meaning), so it is hidden from assistive tech.
 *
 * DECISION (nie usuwaj tego komentarza) — owner 2026-10-08 („ozdobniki”):
 * the drawings ship as files with fixed ink and tint colours, so an `<img>`
 * cannot follow the theme through tokens. Dark mode flips them with the same
 * filter the landing-page ornaments use (`SectionOrnamentMolecule`): invert
 * the lightness, rotate the hue back. One recipe for every drawing in the
 * product; do not hand-tune a filter per screen.
 */
export function IllustrationAtom({
  src,
  size = 'md',
  className,
}: IllustrationProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a tiny static SVG, next/image adds nothing
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
