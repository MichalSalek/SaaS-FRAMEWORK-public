// „Ważne przed wizytą” shown read-only: the one thing the stylist must not miss about a client
// (an allergy, a sensitivity). Stylist screens only; the client never sees it.
//
// DECISION: the warning tone is carried by the icon and the label (warning ink from the tokens),
// on the white surface every section stands on: no tinted card (owner's „biel na papierze”) and
// never a single-sided accent stripe (7×ZERO). `block` = a section of its own (session screen),
// `inline` = one line inside a row (the notes list), where the section title names it already.

import { WarningCircleIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import styles from './ImportantNoteLine.module.css';

export function ImportantNoteLineMolecule({
  note,
  variant = 'block',
}: {
  note: string | null | undefined;
  variant?: 'block' | 'inline';
}) {
  const t = useTranslations('components.importantNote');
  const text = note?.trim() ?? '';
  if (text === '') {
    return null;
  }

  if (variant === 'inline') {
    return (
      <span className={styles.inline}>
        <span className={styles.icon} aria-hidden='true'>
          <WarningCircleIcon size={18} weight='fill' />
        </span>
        <span className={styles.inlineText}>{text}</span>
      </span>
    );
  }

  return (
    <section className={styles.block} aria-label={t('label')}>
      <span className={styles.icon} aria-hidden='true'>
        <WarningCircleIcon size={22} weight='fill' />
      </span>
      <p className={styles.text}>
        <span className={styles.label}>{t('label')}</span>{' '}
        <span className={styles.note}>{text}</span>
      </p>
    </section>
  );
}
