import type { ReactNode, HTMLAttributes } from 'react';
import clsx from 'clsx';
import styles from './Typography.module.css';

type TypographyVariant =
  'h1' | 'h2' | 'h3' | 'h4' | 'body1' | 'body2' | 'caption' | 'subtitle';

type TypographyAlign = 'left' | 'center' | 'right';

export interface TypographyProps extends Omit<
  HTMLAttributes<HTMLElement>,
  'color'
> {
  variant?: TypographyVariant;
  /**
   * Nadpisuje tag HTML niezależnie od wizualu (np. `variant='h4' as='h2'`,
   * gdy hierarchia nagłówków strony wymaga h2, a skala wizualna h4).
   */
  as?: keyof HTMLElementTagNameMap;
  children: ReactNode;
  color?: string;
  align?: TypographyAlign;
  className?: string;
}

const TAG_MAP: Record<TypographyVariant, keyof HTMLElementTagNameMap> = {
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  body1: 'p',
  body2: 'p',
  caption: 'span',
  subtitle: 'p',
};

export function TypographyAtom({
  variant = 'body1',
  as,
  children,
  color,
  align,
  className,
  style,
  ...rest
}: TypographyProps) {
  const Tag = as ?? TAG_MAP[variant];

  return (
    <Tag
      className={clsx(styles.typography, styles[variant], className)}
      style={{
        ...(color ? { color } : {}),
        ...(align ? { textAlign: align } : {}),
        ...style,
      }}
      {...rest}>
      {children}
    </Tag>
  );
}
