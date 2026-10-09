import type { ReactNode } from 'react';
import styles from './MidPageCta.module.css';

export interface MidPageCtaProps {
  /** 1-linijkowy nagłówek — naturalne rozwinięcie sekcji NAD nim (nie powtórka hero). */
  headline: ReactNode;
  /** Akcent-słowo nagłówka (gold-italic, kanon LP). */
  headlineAccent?: ReactNode;
  /** Slot primary action — strona renderuje własny Button/Link (logika funnela
   *  zostaje per-page). Owinięty w data-cta-shimmer='on' (efekt „living CTA"). */
  action: ReactNode;
  /** Cicha linia reassurance pod akcją (SLA, „bez karty", proof). */
  reassurance?: ReactNode;
  className?: string;
}

/**
 * MidPageCta — lekki, wyśrodkowany blok CTA wstawiany MIĘDZY sekcjami LP
 * („co drugą sekcję", owner S81), żeby skimmer miał zakotwiczony przycisk w
 * martwej strefie środka strony. NIE full-bleed band (to rola FinalCtaBand) —
 * ciche domknięcie sekcji whitespace'em + hairline u góry. Nagłówek dopasowany
 * do sekcji nad nim; primary CTA niesie efekt shimmer.
 */
export function MidPageCtaMolecule({
  headline,
  headlineAccent,
  action,
  reassurance,
  className,
}: MidPageCtaProps) {
  return (
    <section className={`${styles.midCta} ${className ?? ''}`}>
      <div className={styles.inner}>
        <p className={styles.headline}>
          {headline}
          {headlineAccent != null && (
            <>
              {' '}
              <span className={styles.headlineAccent}>{headlineAccent}</span>
            </>
          )}
        </p>
        <div className={styles.actions} data-cta-shimmer='on'>
          {action}
        </div>
        {reassurance != null && (
          <p className={styles.reassurance}>{reassurance}</p>
        )}
      </div>
    </section>
  );
}
