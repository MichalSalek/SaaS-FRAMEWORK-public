import clsx from 'clsx';
import styles from './ColorDot.module.css';

export type ColorDotSize = 'sm' | 'md' | 'quick' | 'lg';

export interface ColorDotProps {
  color: string;
  size?: ColorDotSize;
  className?: string;
}

const WHITE_COLORS = new Set(['#ffffff', '#fff', '#FFFFFF', '#FFF']);

export function ColorDotAtom({ color, size = 'md', className }: ColorDotProps) {
  return (
    <span
      className={clsx(
        styles.dot,
        styles[size],
        WHITE_COLORS.has(color) && styles.white,
        className
      )}
      style={{ backgroundColor: color }}
      role='presentation'
      aria-hidden='true'
    />
  );
}
