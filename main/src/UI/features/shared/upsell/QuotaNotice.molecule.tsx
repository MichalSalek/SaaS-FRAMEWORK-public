import type {
  QuotaFeature,
  QuotaSnapshot,
} from '../../../../application/pricing/quota.helpers';
import { useQuotaTranslations } from './quotaTranslations';
import styles from './QuotaNotice.module.css';

export function QuotaNoticeMolecule({
  feature,
  quota,
  className,
}: {
  feature: QuotaFeature;
  quota: QuotaSnapshot;
  className?: string;
}) {
  const t = useQuotaTranslations();
  if (quota.state !== 'one_remaining' && quota.state !== 'exhausted') {
    return null;
  }

  const message = t(`components.quotaStatus.${quota.state}.${feature}`, {
    count: quota.count,
    limit: quota.limit,
  });

  return (
    <p
      className={[styles.notice, 'micro-enter', className]
        .filter(Boolean)
        .join(' ')}
      role='status'
      data-quota-state={quota.state}>
      {message}
    </p>
  );
}
