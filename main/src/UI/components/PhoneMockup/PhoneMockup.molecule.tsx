import Head from 'next/head';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { responsiveImageSources } from '../../assets/responsive-assets.config';
import styles from './PhoneMockup.module.css';

export interface PhoneMockupProps {
  label: string;
  route: string;
  state?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'xxl' | 'hero';
  className?: string;
  /** Real app screenshot src (capture z /app/* przez scripts/qa-screenshot.cjs,
   *  drop do main/public/img/lp/). Gdy brak — renderuje honest placeholder
   *  (schematyczny podglad), nie pusty/zepsuty ekran. Wstawienie = swap danych. */
  screenshot?: string;
  /**
   * The mockup is the first screen's picture (a hero): fetch it at once and
   * ahead of other images instead of waiting for the lazy-load observer.
   * Leave it off below the fold.
   */
  aboveFold?: boolean;
  /**
   * Drawn width for the image optimizer when the context draws the frame
   * narrower than its size cap (the hero clip, a grid cell). Without it the
   * cap below is used.
   */
  sizes?: string;
}

/**
 * PhoneMockup — placeholder for a product screenshot.
 *
 * `label` describes the exact screen/state to capture.
 * `route`  is the app route shown as metadata.
 * `state`  is optional context (e.g. "stylistka, 12 zdjęć").
 */
/* DECISION: the figcaption was REMOVED from the component: captions under the screens (working
 * dev annotations such as "/app/pairing") were to be removed EVERYWHERE. The screen description
 * lives only in aria-label; the wrapper holds the dimension through the frame. Do NOT bring back
 * visible captions without the owner's say. (owner) */
export function PhoneMockupMolecule({
  label,
  route,
  state,
  size = 'md',
  className,
  screenshot,
  aboveFold = false,
  sizes,
}: PhoneMockupProps) {
  const t = useTranslations('phoneMockup');
  const fullCaption = state ? `${label}: ${state}` : label;
  // DECISION: the `sizes` hint is the frame's CSS width CAP (`.frame` width in
  // PhoneMockup.module.css; `max-width: 90%` only ever narrows it), never more. next/image
  // multiplies by the device pixel ratio itself, so a hint above the cap only buys a bigger file
  // (PageSpeed reported the home hero screenshot sent at 629px for a 405px slot). A context that
  // draws the frame narrower passes `sizes`.
  const sizesHint: Record<NonNullable<PhoneMockupProps['size']>, string> = {
    sm: '160px',
    md: '200px',
    lg: '260px',
    xl: '320px',
    xxl: '420px',
    hero: '400px',
  };

  const imageSizes = sizes ?? sizesHint[size];
  const responsive = screenshot
    ? responsiveImageSources(screenshot)
    : undefined;

  return (
    <figure
      className={`${styles.wrapper} ${styles[size]} ${className ?? ''}`}
      data-no-caption=''
      aria-label={t('ariaLabel', { caption: fullCaption })}>
      <div className={styles.frame} aria-hidden='true'>
        {responsive ? (
          // DECISION: a screen with pre-cut AVIF/WebP files (manifest `responsive.widths`, see
          // scripts/assets/library.mjs) skips `next/image`. The home hero shot is the landing
          // page's LCP, and every `/_next/image` request misses the Cloudflare edge and waits on
          // the hosting's image optimizer, which can only emit WebP. The static files are edge HITs, AVIF
          // is about 40% lighter at the same look, and the head preload keeps the request as early
          // as next/image's own preload did. Same box, same `cover`.
          <>
            {aboveFold ? (
              <Head>
                <link
                  key={`phone-shot-preload-${responsive.fallbackSrc}`}
                  rel='preload'
                  as='image'
                  type='image/avif'
                  imageSrcSet={responsive.avifSrcSet}
                  imageSizes={imageSizes}
                  fetchPriority='high'
                />
              </Head>
            ) : null}
            <picture className={styles.screenshotPicture}>
              <source
                type='image/avif'
                srcSet={responsive.avifSrcSet}
                sizes={imageSizes}
              />
              {/* no-img-element exemption: the <img> of a <picture> (the
                  ESLint rule skips it), pre-cut static variants. */}
              <img
                className={styles.screenshotImg}
                src={responsive.fallbackSrc}
                srcSet={responsive.webpSrcSet}
                sizes={imageSizes}
                alt=''
                decoding='async'
                loading={aboveFold ? 'eager' : 'lazy'}
                fetchPriority={aboveFold ? 'high' : 'auto'}
              />
            </picture>
          </>
        ) : screenshot ? (
          <Image
            className={styles.screenshotImg}
            src={screenshot}
            alt=''
            fill
            sizes={imageSizes}
            loading={aboveFold ? 'eager' : 'lazy'}
            fetchPriority={aboveFold ? 'high' : 'auto'}
            style={{ objectFit: 'cover' }}
          />
        ) : (
          <div className={styles.screen}>
            {/* Honest placeholder: schematyczny podglad dopoki realny screenshot
                nie jest podpiety (prop `screenshot`). */}
            <div className={styles.screenGrid}>
              <div className={styles.screenTile} />
              <div className={styles.screenTile} />
              <div className={styles.screenTile} />
              <div className={styles.screenTile} />
              <div className={styles.screenTile} />
            </div>
            <span className={styles.routePill}>{route}</span>
          </div>
        )}
      </div>
    </figure>
  );
}
