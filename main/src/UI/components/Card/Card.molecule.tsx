import type { ReactNode, HTMLAttributes } from 'react';
import clsx from 'clsx';
import styles from './Card.module.css';

type CardVariant = 'outlined' | 'elevated';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  highlighted?: boolean;
  children?: ReactNode;
  className?: string;
}

export function CardMolecule({
  variant = 'outlined',
  highlighted = false,
  children,
  className,
  ...rest
}: CardProps) {
  return (
    <div
      className={clsx(
        styles.card,
        styles[variant],
        { [styles.highlighted ?? '']: highlighted },
        className
      )}
      {...rest}>
      {children}
    </div>
  );
}

/* ─── Sub-components ─── */

export interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  className?: string;
}

export function CardHeaderAtom({
  children,
  className,
  ...rest
}: CardHeaderProps) {
  return (
    <div className={clsx(styles.header, className)} {...rest}>
      {children}
    </div>
  );
}

export interface CardContentProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  className?: string;
}

export function CardContentAtom({
  children,
  className,
  ...rest
}: CardContentProps) {
  return (
    <div className={clsx(styles.content, className)} {...rest}>
      {children}
    </div>
  );
}

export interface CardActionsProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  className?: string;
}

export function CardActionsAtom({
  children,
  className,
  ...rest
}: CardActionsProps) {
  return (
    <div className={clsx(styles.actions, className)} {...rest}>
      {children}
    </div>
  );
}
