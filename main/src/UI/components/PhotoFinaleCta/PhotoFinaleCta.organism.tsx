import { useId, type CSSProperties, type ReactNode } from 'react';
import Image, { type ImageProps } from 'next/image';
import clsx from 'clsx';
import { staticAssetDimensions } from '../../assets/static-asset-size.config';
import styles from './PhotoFinaleCta.module.css';

export type PhotoFinaleCtaImageSide = 'left' | 'right';

/**
 * Public CSS hooks (set on `className` / `style`; private `--_*` stay in the
 * module). Vote variants can retune density or crop without a fork.
 */
export type PhotoFinaleCtaStyle = CSSProperties & {
  '--photo-finale-image-share'?: string;
  '--photo-finale-text-share'?: string;
  '--photo-finale-image-object-position'?: string;
  '--photo-finale-pad-block'?: string;
  '--photo-finale-pad-inline'?: string;
  '--photo-finale-headline-size'?: string;
  '--photo-finale-photo-min-block'?: string;
};

export interface PhotoFinaleCtaProps {
  /** Desktop photo column. Mobile is always text, then image. */
  imageSide: PhotoFinaleCtaImageSide;
  imageSrc: ImageProps['src'];
  /** Decorative by default (empty alt + hidden frame). */
  imageAlt?: string;
  heading: ReactNode;
  body?: ReactNode;
  actions: ReactNode;
  footnote?: ReactNode;
  className?: string;
  style?: PhotoFinaleCtaStyle;
  /** Stable id when the page anchors this heading. Omit in the library. */
  headingId?: string;
}

/** Accent word inside the `heading` slot (Marcellus on ink). */
export function PhotoFinaleCtaAccent({ children }: { children: ReactNode }) {
  return <span className={styles.headlineAccent}>{children}</span>;
}

/**
 * PhotoFinaleCta — photo + text ink finale (home form, shared).
 *
 * DECISION (nie usuwaj tego komentarza):
 * Home finale is a real 2-column grid (photo is a track, not absolute decor).
 * FinalCtaBand's decor slot is a centered stack; ForClients' absolute right
 * panel slid under the copy at ~1500px. This organism is the photo-grid
 * canon. Root is width:100% — parents already break out to the viewport;
 * nested 100vw + calc(50% - 50vw) clips ~15px on a classic scrollbar.
 */
export function PhotoFinaleCtaOrganism({
  imageSide,
  imageSrc,
  imageAlt = '',
  heading,
  body,
  actions,
  footnote,
  className,
  style,
  headingId: headingIdProp,
}: PhotoFinaleCtaProps) {
  const generatedHeadingId = useId();
  const headingId = headingIdProp ?? generatedHeadingId;
  const isDecorative = imageAlt === '';
  const native =
    typeof imageSrc === 'string' ? staticAssetDimensions(imageSrc) : undefined;
  const landscape = native ? native.width > native.height : false;

  return (
    <section
      className={clsx(styles.section, className)}
      style={style}
      data-image-side={imageSide}
      aria-labelledby={headingId}>
      <div className={styles.pattern} aria-hidden='true' />
      <span className={styles.edgeLeft} aria-hidden='true' />
      <span className={styles.edgeRight} aria-hidden='true' />
      <div className={styles.inner}>
        <h2 id={headingId} className={styles.headline}>
          {heading}
        </h2>
        {body != null && <p className={styles.body}>{body}</p>}
        <div className={styles.actions}>{actions}</div>
        {footnote != null && <p className={styles.footnote}>{footnote}</p>}
      </div>
      <div
        className={styles.photoFrame}
        data-landscape={landscape || undefined}
        data-native-photo={native ? 'true' : undefined}
        style={
          native
            ? ({
                '--photo-native-aspect': `${native.width} / ${native.height}`,
                '--photo-native-retina-width': `${native.width / 2}px`,
              } as CSSProperties)
            : undefined
        }
        aria-hidden={isDecorative || undefined}>
        <Image
          quality={95}
          className={styles.photo}
          src={imageSrc}
          alt={imageAlt}
          fill
          sizes='(max-width: 859px) 100vw, 60vw'
        />
      </div>
    </section>
  );
}
