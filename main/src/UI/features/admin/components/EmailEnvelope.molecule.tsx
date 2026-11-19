import { useTranslations } from 'next-intl';
import type { AdminGetEmailPreviewResponse } from '@kernel/models/admin/admin-mailing.dto';
import { SkeletonAtom } from '../../../components/Skeleton/Skeleton.atom';
import styles from '../AdminEmailPreviewPage.module.css';

export function EmailEnvelopeMolecule({
  preview,
  loading,
}: {
  preview: AdminGetEmailPreviewResponse | null;
  loading: boolean;
}) {
  const t = useTranslations('admin.emailPreview');
  const fields = [
    { label: t('senderLabel'), value: preview?.from },
    { label: t('replyToLabel'), value: preview?.replyTo },
    { label: t('subjectLabel'), value: preview?.subject },
    { label: t('preheaderLabel'), value: preview?.preheader },
  ];
  return (
    <div>
      {fields.map(field => (
        <p className={styles.subject} key={field.label}>
          <span className={styles.subjectLabel}>{field.label}</span>
          <span className={styles.subjectValue}>
            {loading ? (
              <SkeletonAtom variant='text' width='16rem' height='1lh' />
            ) : (
              (field.value ?? null)
            )}
          </span>
        </p>
      ))}
    </div>
  );
}
