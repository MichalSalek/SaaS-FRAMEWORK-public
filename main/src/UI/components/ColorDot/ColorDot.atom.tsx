import clsx from 'clsx';
import { colorVariableStyle } from '../../../application/colors/color-css-variables';
import { getColorDisplay } from './ColorDot.config';
import styles from './ColorDot.module.css';

export type ColorDotSize = 'sm' | 'md' | 'quick' | 'lg';
export interface ColorDotProps {
  color: string;
  size?: ColorDotSize;
  className?: string;
}

export function ColorDotAtom({ color, size = 'md', className }: ColorDotProps) {
  const display = getColorDisplay(color);
  return (
    <span
      className={clsx(
        styles.dot,
        styles[size],
        color.toLowerCase() === '#ffffff' && styles.white,
        className
      )}
      data-polish-metallic={display.metallic || undefined}
      style={colorVariableStyle('--polish-fill', display.fill)}
      role='presentation'
      aria-hidden='true'
    />
  );
}
