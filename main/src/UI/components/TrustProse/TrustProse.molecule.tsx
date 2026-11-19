import type { ReactNode } from 'react';
import clsx from 'clsx';
import styles from './TrustProse.module.css';

export interface TrustProseProps {
  /** Authored editorial sentence; nested <em> inherits its foreground
   *  (render call-site with `t.rich('key', { em: c => <em>{c}</em> })`). */
  sentence: ReactNode;
  /** Quiet caption below the sentence (e.g. VAT note). */
  note?: ReactNode;
  /** 'ink' when placed on a dark/negative surface. */
  tone?: 'light' | 'ink';
  /** 'start' left-aligns (e.g. inside a split column). */
  align?: 'center' | 'start';
  className?: string;
}

/**
 * TrustProse — canonical trust prose (owner vote). One editorial serif
 * sentence in one foreground, no icons: narrative instead
 * of a badge strip (TrustSignals in the authority/trust role).
 * Static (non-interactive): no hover (floor §4).
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
