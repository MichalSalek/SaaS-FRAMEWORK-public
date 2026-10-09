import type { ReactNode } from 'react';
import clsx from 'clsx';
import styles from './TrustProse.module.css';

export interface TrustProseProps {
  /** Authored editorial sentence; may contain <em> gold-italic accents
   *  (render call-site with `t.rich('key', { em: c => <em>{c}</em> })`). */
  sentence: ReactNode;
  /** Quiet caption below the sentence (e.g. VAT note). */
  note?: ReactNode;
  /** 'ink' when placed on a dark/negatyw surface. */
  tone?: 'light' | 'ink';
  /** 'start' left-aligns (e.g. inside a split column). */
  align?: 'center' | 'start';
  className?: string;
}

/**
 * TrustProse — kanoniczna proza zaufania (głos ownera /ui S52 = wariant C).
 * Zastąpiła ikona+bullet trust-listę (TrustSignals w roli authority/trust)
 * recyklowaną na powierzchniach LP. Jedno editorial zdanie serif z gold-italic
 * akcentami na słowach-kluczach, zero ikon — narracja zamiast badge-stripu.
 * Statyczne (nieinteraktywne): zero hover (floor §4).
 */
export function TrustProseMolecule({
  sentence,
  note,
  tone = 'light',
  align = 'center',
  className,
}: TrustProseProps) {
  return (
    <div
      className={clsx(
        styles.wrap,
        tone === 'ink' && styles.ink,
        align === 'start' && styles.start,
        className
      )}>
      <p className={styles.prose}>{sentence}</p>
      {note != null && <p className={styles.note}>{note}</p>}
    </div>
  );
}
