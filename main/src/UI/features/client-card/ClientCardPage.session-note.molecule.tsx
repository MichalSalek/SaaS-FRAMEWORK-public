import { useTranslations } from 'next-intl';
import styles from './ClientCardPage.module.css';

/** The client's own note on the session a visit came from. Labelled as hers:
 *  she wrote it and she sees it, unlike the stylist's visit note. */
export function SessionClientNoteMolecule({ note }: { note: string }) {
  const t = useTranslations('clientCard');
  return (
    <div className={styles.clientSessionNote}>
      <p className={styles.clientSessionNoteLabel}>
        {t('clientSessionNoteLabel')}
      </p>
      <p className={styles.clientSessionNoteText}>{note}</p>
    </div>
  );
}
