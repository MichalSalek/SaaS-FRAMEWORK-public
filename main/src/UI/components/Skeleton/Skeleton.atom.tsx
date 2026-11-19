import clsx from 'clsx';
import styles from './Skeleton.module.css';

type SkeletonVariant = 'rect' | 'text' | 'circle';

export interface SkeletonProps {
  variant?: SkeletonVariant;
  width?: string | number;
  height?: string | number;
  className?: string;
}

export function SkeletonAtom({
  variant = 'rect',
  width,
  height,
  className,
}: SkeletonProps) {
  return (
    <span
      className={clsx(styles.skeleton, styles[variant], className)}
      style={{
        ...(width !== undefined
          ? { width: typeof width === 'number' ? `${width}px` : width }
          : {}),
        ...(height !== undefined
          ? { height: typeof height === 'number' ? `${height}px` : height }
          : {}),
      }}
      role='presentation'
      aria-hidden='true'
    />
  );
}
