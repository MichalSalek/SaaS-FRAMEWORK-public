import { ImagesIcon } from '@phosphor-icons/react';
import styles from './ImagePlaceholder.module.css';

interface ImagePlaceholderProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function ImagePlaceholderAtom({
  size = 'md',
  className,
}: ImagePlaceholderProps) {
  return (
    <div className={`${styles.placeholder} ${styles[size]} ${className ?? ''}`}>
      <ImagesIcon size={size === 'sm' ? 16 : size === 'md' ? 24 : 32} />
    </div>
  );
}
