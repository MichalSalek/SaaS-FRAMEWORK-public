import type { ReactNode } from 'react';
import {
  PhoneMockupMolecule,
  type PhoneMockupProps,
} from '../PhoneMockup/PhoneMockup.molecule';
import styles from './PhoneQuoteStrip.module.css';

export interface PhoneQuoteStripProps {
  /** Screen aplikacji w ramce telefonu (domyślnie size lg). */
  phone: PhoneMockupProps;
  /** Tytuł-cytat; <em> w treści dostaje gold-italic (accent-fg). */
  quoteTitle: ReactNode;
  quoteBody?: ReactNode;
  quoteNote?: ReactNode;
  /** Wyeksponowany rząd konkretów pod cytatem („co dokładnie" — np. bundle
   * „pamięć o klientce"). Oddzielony górnym hairline, medium-weight — bije
   * italic quoteNote. Opcjonalny: pozostałe call-sites bez zmian. */
  quoteFacts?: ReactNode;
  className?: string;
}

/**
 * PhoneQuoteStrip — zamknięty asymetryczny pas „dowód + cytat":
 * screen aplikacji w ramce telefonu (0.9fr) obok wyciągniętego
 * benefit-cytatu (1.4fr), całość w jednej hairline-karcie.
 *
 * Pochodzenie: głosowanie S24/1 wariant B — wygrał A, ale owner o B:
 * „też wspaniałe, zapisałbym tego molekuła do biblioteki". Forma
 * przeniesiona 1:1 z playgroundu (.v1bStrip/.v1bQuote*).
 */
export function PhoneQuoteStripOrganism({
  phone,
  quoteTitle,
  quoteBody,
  quoteNote,
  quoteFacts,
  className,
}: PhoneQuoteStripProps) {
  return (
    <div className={`${styles.strip} ${className ?? ''}`}>
      <div className={styles.phoneCol}>
        <PhoneMockupMolecule size='lg' {...phone} />
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
