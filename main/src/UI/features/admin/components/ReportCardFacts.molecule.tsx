// admin/components/ReportCardFacts.molecule.tsx
// What a moderator reads before deciding: who reported, which gallery record,
// the full description and an earlier admin note. Plain label and value pairs
// on the card's own surface (no frame of their own).

import { useTranslations } from 'next-intl';
import type { ContentReportItem } from '../hooks/useModerationReports';
import styles from '../AdminModerationPage.module.css';

export function ReportCardFactsMolecule({
  report,
  reporterName,
}: {
  report: ContentReportItem;
  /** Resolved by the card (name, then e-mail, then the translated fallback). */
  reporterName: string;
}) {
  const t = useTranslations('admin.moderation');
  const reporterEmail = report.reporter?.email?.trim() || null;

  return (
    <dl className={styles.facts}>
      <div className={styles.fact}>
        <dt className={styles.factLabel}>{t('detailReporter')}</dt>
        {/* E-mail in parentheses only when it is not already the name itself: an anonymous reporter
            rendered as a name with empty parentheses. */}
        <dd className={styles.factValue}>
          {reporterName}
          {reporterEmail !== null && reporterEmail !== reporterName
            ? ` (${reporterEmail})`
            : ''}
        </dd>
      </div>
      {report.description && (
        <div className={styles.fact}>
          <dt className={styles.factLabel}>{t('detailDescription')}</dt>
          <dd className={styles.factValue}>{report.description}</dd>
        </div>
      )}
      {report.admin_note && (
        <div className={styles.fact}>
          <dt className={styles.factLabel}>{t('detailAdminNote')}</dt>
          <dd className={styles.factValue}>{report.admin_note}</dd>
        </div>
      )}
      <div className={styles.fact}>
        <dt className={styles.factLabel}>{t('detailReportId')}</dt>
        <dd className={styles.factId}>{report.id}</dd>
      </div>
      {/* The relation has onDelete: SetNull: after the photo is deleted the report lives on without a
          gallery record, and the sentence at the decision says so. */}
      {report.gallery_record_id != null && (
        <div className={styles.fact}>
          <dt className={styles.factLabel}>{t('detailGalleryRecord')}</dt>
          <dd className={styles.factId}>{report.gallery_record_id}</dd>
        </div>
      )}
    </dl>
  );
}
