import type { ReactNode } from 'react';
import clsx from 'clsx';
import styles from './LpHero.module.css';
import { KeepTogetherTextAtom } from '../KeepTogetherText/KeepTogetherText.atom';

export interface LpHeroProps {
  /** Large headline. It is the page's `<h1>` unless `lead` is given. */
  headline: ReactNode;
  /** Trailing headline text; inherits the whole heading style. */
  headlineAccent?: ReactNode;
  /**
   * The page's key phrase as an `<h1>` RUN INTO the description: the first, bold
   * words of the paragraph under the headline („Aplikacja dla stylistek paznokci.
   * Dodajesz zdjęcia…”). When given, the large headline drops to `<h2>`; exactly
   * one `<h1>` per page. The text ends with a period.
   */
  lead?: ReactNode;
  /** Description under the headline: one, at most two sentences. */
  lede?: ReactNode;
  /** Slot for the page's buttons (CTA logic stays per page). */
  actions?: ReactNode;
  /** ONE line under the actions: what it costs and what the click risks. Not a list. */
  meta?: ReactNode;
  /** Quiet exit for the other audience (e.g. „Chodzę na paznokcie”): it sits
   *  BELOW the `meta` line so that line stays next to the button it refers to. */
  aside?: ReactNode;
  /** The page's signature mark: PhoneMockup / collage / photo / small stage. */
  media?: ReactNode;
  /** `split`: text beside the media from 768 px. `center`: text centred, media
   *  below it at full width. */
  layout?: 'split' | 'center';
  /** `paper` (default) or a white edge-to-edge band. */
  tone?: 'paper' | 'white';
  /** Headline id; the section gets aria-labelledby. */
  headingId?: string;
  /** The page may add its own background or nuance. */
  className?: string;
  /** Sweep shimmer on the primary CTA (first-child). Off by default, which skips
   *  outlined-only heroes in /dev/ui (the sweep makes sense only on a solid primary). */
  shimmerCta?: boolean;
}

/**
 * LpHero: the canonical hero of static pages (LP).
 *
 * DECISION: LpHero is the ONLY landing-page hero pattern (copies drifted per page).
 * Visuals and typography live HERE; pages supply only content (i18n) and action
 * logic, extending through className rather than per-page .hero* classes.
 * The entire heading uses one foreground color; see LpHero.module.css.
 *
 * DECISION: the hero is concrete and simple (owner): NO small label above the
 * headline (no `eyebrow` prop); the key phrase is the `<h1>`, folded into the
 * description as its first words (`lead`) when it does not fit the headline; ONE
 * `meta` line under the button, no assurance list, no paid-plan price sentence;
 * each page stands out with its own `media`, visible on the first phone screen.
 */
export function LpHeroOrganism({
  headline,
  headlineAccent,
  lead,
  lede,
  actions,
  meta,
  aside,
  media,
  layout = 'split',
  tone = 'paper',
  headingId,
  className,
  shimmerCta = false,
}: LpHeroProps) {
  // The key phrase run into the description is the h1, so the large headline is an h2.
  const HeadlineTag = lead != null ? 'h2' : 'h1';

  return (
    <section
      className={clsx(styles.hero, className)}
      aria-labelledby={headingId}
      data-layout={layout}
      data-tone={tone}
      data-has-media={media != null || undefined}>
      <div className={styles.inner}>
        <div className={styles.content}>
          <HeadlineTag id={headingId} className={styles.headline}>
            {headline}
            {headlineAccent != null && <> {headlineAccent}</>}
          </HeadlineTag>
          {lead != null ? (
            <div className={styles.lede}>
              <h1 className={styles.lead}>{lead}</h1>{' '}
              {lede != null && <p className={styles.ledeRest}>{lede}</p>}
            </div>
          ) : (
            lede != null && <p className={styles.lede}>{lede}</p>
          )}
          {actions != null && (
            <div
              className={styles.actions}
              data-cta-shimmer={shimmerCta ? 'on' : undefined}>
              {actions}
            </div>
          )}
          {meta != null && (
            <div className={styles.meta}>
              {typeof meta === 'string' ? (
                // One element: `.meta` is a flex column, and loose text
                // around a kept piece would become three stacked items.
                <span>
                  <KeepTogetherTextAtom>{meta}</KeepTogetherTextAtom>
                </span>
              ) : (
                meta
              )}
            </div>
          )}
          {aside != null && <div className={styles.aside}>{aside}</div>}
        </div>
        {media != null && <div className={styles.media}>{media}</div>}
      </div>
    </section>
  );
}
