import type { ReactNode } from 'react';
import {
  PhoneMockupMolecule,
  type PhoneMockupProps,
} from '../PhoneMockup/PhoneMockup.molecule';
import styles from './PhoneQuoteStrip.module.css';

export interface PhoneQuoteStripProps {
  /** App screen in a phone frame (default size lg). */
  phone?: PhoneMockupProps;
  /** Instead of a phone: a scene drawn from the product (e.g. the conversation
   *  before a visit). Same column; it wins over `phone`. */
  visual?: ReactNode;
  /** Title quote; nested emphasis keeps the same foreground color. */
  quoteTitle: ReactNode;
  quoteBody?: ReactNode;
  quoteNote?: ReactNode;
  /** Highlighted row of specifics under the quote („co dokładnie”, e.g. the
   * „pamięć o klientce” bundle). Separated by a top hairline, medium weight, so
   * it beats the italic quoteNote. Optional. */
  quoteFacts?: ReactNode;
  className?: string;
}

/**
 * PhoneQuoteStrip: a closed asymmetric „proof + quote” strip: an app screen in
 * a phone frame (0.9fr) beside a pulled benefit quote (1.4fr). A runner-up of an
 * owner vote, kept as a library molecule at the owner's request.
 */
export function PhoneQuoteStripOrganism({
  phone,
  visual,
  quoteTitle,
  quoteBody,
  quoteNote,
  quoteFacts,
  className,
}: PhoneQuoteStripProps) {
  return (
    <div className={`${styles.strip} ${className ?? ''}`}>
      <div className={styles.phoneCol}>
        {visual ??
          (phone !== undefined && <PhoneMockupMolecule size='lg' {...phone} />)}
      </div>
      <blockquote className={styles.quote}>
        <p className={styles.title}>{quoteTitle}</p>
        {quoteBody != null && <p className={styles.body}>{quoteBody}</p>}
        {quoteFacts != null && <p className={styles.facts}>{quoteFacts}</p>}
        {quoteNote != null && <p className={styles.note}>{quoteNote}</p>}
      </blockquote>
    </div>
  );
}
