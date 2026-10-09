import type { ReactNode } from 'react';
import { EyebrowAtom } from '../Eyebrow/Eyebrow.atom';
import styles from './FinalCtaBand.module.css';

export interface FinalCtaBandProps {
  /**
   * Konwencja F3 (głos ownera S22/5 = B): 'gold' na stronach KONWERSYJNYCH
   * (pricing, compare, get-app), 'ink' na INFORMACYJNYCH (about, contact,
   * for-clients, for-stylists, for-studios). Ton finału niesie rolę strony.
   */
  tone?: 'gold' | 'ink';
  /** Linia 1 headline'u — renderowana BIAŁA (kanon, głos ownera S21). */
  headlineLine1: ReactNode;
  /** Linia 2 — italic akcent w primary-contrast. */
  headlineAccent?: ReactNode;
  eyebrow?: ReactNode;
  body?: ReactNode;
  /** Slot primary action — strona renderuje własny Button/Link
   *  (logika plan-aware / mode-aware zostaje per-page); label buttona
   *  styluje molecule (biały). */
  actions: ReactNode;
  /** Goły <Link>/<a> — molecule nadaje styl podkreślonego linku na bandzie. */
  secondary?: ReactNode;
  /** Linia reassurance pod akcjami. */
  footnote?: ReactNode;
  /** Dekor specyficzny strony (np. foto-rama for-clients) — pozycjonowanie
   *  w CSS strony, renderowany pod patternem. */
  decor?: ReactNode;
  headingId?: string;
  className?: string;
}

/**
 * FinalCtaBand — jedyny wzorzec final CTA na pełnym bandzie (8 stron).
 * Wizual i kanon kolorów żyją TUTAJ; strony dostarczają wyłącznie treść
 * (i18n) i logikę akcji. Dwa tony (konwencja F3): gold = miejsce decyzji,
 * ink = spokojne zamknięcie strony informacyjnej.
 */
export function FinalCtaBandOrganism({
  tone = 'gold',
  headlineLine1,
  headlineAccent,
  eyebrow,
  body,
  actions,
  secondary,
  footnote,
  decor,
  headingId,
  className,
}: FinalCtaBandProps) {
  return (
    <section
      className={`${styles.band} ${tone === 'ink' ? styles.bandInk : ''} ${className ?? ''}`}
      aria-labelledby={headingId}>
      {decor}
      <div className={styles.pattern} aria-hidden='true' />
      <div className={styles.inner}>
        {eyebrow != null && (
          <EyebrowAtom as='p' variant='chip'>
            {eyebrow}
          </EyebrowAtom>
        )}
        <h2 id={headingId} className={styles.headline}>
          {headlineLine1}
          {headlineAccent != null && (
            <>
              <br />
              <span className={styles.headlineAccent}>{headlineAccent}</span>
            </>
          )}
        </h2>
        {body != null && <p className={styles.body}>{body}</p>}
        {/* data-cta-shimmer='on': powolny sweep na primary CTA (global.css) */}
        <div className={styles.actions} data-cta-shimmer='on'>
          {actions}
          {secondary != null && (
            <span className={styles.secondaryWrap}>{secondary}</span>
          )}
        </div>
        {footnote != null && <p className={styles.footnote}>{footnote}</p>}
      </div>
    </section>
  );
}
