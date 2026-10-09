import { staticAssetWidth } from './static-asset-size.config';
import type { CSSProperties } from 'react';
import Image from 'next/image';
import clsx from 'clsx';
import styles from './ProcessIllustration.module.css';

export function ProcessIllustrationMolecule({
  src,
  alt,
  className,
  width = 1774,
  height = 887,
  sizes = '(max-width: 768px) calc(100vw - 32px), 880px',
}: {
  src: string;
  alt: string;
  className?: string;
  width?: number;
  height?: number;
  sizes?: string;
}) {
  return (
    <div
      className={clsx(styles.frame, className)}
      style={
        {
          '--illustration-native-width': `${staticAssetWidth(src, width) / 2}px`,
        } as CSSProperties
      }
      data-illustration='framed'>
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        sizes={sizes}
        className={styles.image}
        quality={95}
        unoptimized={src.split('?')[0]?.endsWith('.svg')}
      />
    </div>
  );
}
